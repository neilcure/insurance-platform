import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { accountingInvoices, accountingInvoiceItems, accountingPayments } from "@/db/schema/accounting";
import { formOptions } from "@/db/schema/form_options";
import { and, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/require-user";
import { readPdfTemplate } from "@/lib/storage-pdf-templates";
import { PDF_TEMPLATE_GROUP_KEY } from "@/lib/types/pdf-template";
import type { PdfTemplateMeta, PdfImageMapping } from "@/lib/types/pdf-template";
import { generateFilledPdf } from "@/lib/pdf/generate";
import { buildMergeContext } from "@/lib/pdf/build-context";
import type { InvoiceContext } from "@/lib/pdf/resolve-data";
import type { DocumentStatusMap, DocumentStatusEntry } from "@/lib/types/accounting";

export const dynamic = "force-dynamic";

type DocTypeKey = "quotation" | "invoice" | "receipt" | "statement";

function inferDocType(templateLabel: string): DocTypeKey | null {
  const lower = templateLabel.toLowerCase();
  if (lower.includes("receipt")) return "receipt";
  if (lower.includes("statement")) return "statement";
  if (lower.includes("quotation") || lower.includes("quote")) return "quotation";
  if (lower.includes("invoice") || lower.includes("debit note")) return "invoice";
  return null;
}

function checkDocumentRules(
  docType: DocTypeKey | null,
  invoice: { direction: string; documentStatus: unknown },
  hasVerifiedPayment: boolean,
): string | null {
  if (!docType) return null;

  const docStatus = (invoice.documentStatus as DocumentStatusMap | null) ?? {};

  if (docType === "invoice") {
    if (invoice.direction === "receivable") {
      const quotation = docStatus.quotation;
      if (quotation && quotation.status !== "confirmed") {
        return "Cannot generate invoice: quotation must be confirmed first";
      }
    }
  }

  if (docType === "receipt") {
    if (!hasVerifiedPayment) {
      return "Cannot generate receipt: at least one payment must be verified first";
    }
  }

  return null;
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    await requireUser();
    const { id } = await ctx.params;
    const invoiceId = Number(id);
    const body = await request.json();
    const { templateId } = body;

    if (!templateId) {
      return NextResponse.json({ error: "templateId is required" }, { status: 400 });
    }

    const [invoice] = await db
      .select()
      .from(accountingInvoices)
      .where(eq(accountingInvoices.id, invoiceId))
      .limit(1);

    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    const [tplRow] = await db
      .select()
      .from(formOptions)
      .where(
        and(
          eq(formOptions.id, Number(templateId)),
          eq(formOptions.groupKey, PDF_TEMPLATE_GROUP_KEY),
        ),
      )
      .limit(1);

    if (!tplRow) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    const meta = tplRow.meta as unknown as PdfTemplateMeta | null;
    if (!meta?.filePath || (!meta.fields?.length && !meta.images?.length)) {
      return NextResponse.json(
        { error: "Template has no PDF or field/image mappings" },
        { status: 400 },
      );
    }

    const docType = inferDocType(tplRow.label);

    const verifiedPayments = await db
      .select({ id: accountingPayments.id })
      .from(accountingPayments)
      .where(and(
        eq(accountingPayments.invoiceId, invoiceId),
        eq(accountingPayments.status, "verified"),
      ))
      .limit(1);

    const ruleError = checkDocumentRules(docType, invoice, verifiedPayments.length > 0);
    if (ruleError) {
      return NextResponse.json({ error: ruleError }, { status: 400 });
    }

    const items = await db
      .select({
        policyId: accountingInvoiceItems.policyId,
      })
      .from(accountingInvoiceItems)
      .where(eq(accountingInvoiceItems.invoiceId, invoiceId));

    const firstPolicyId = items[0]?.policyId;

    let mergeCtx = await (async () => {
      if (firstPolicyId) {
        const result = await buildMergeContext(firstPolicyId);
        if (result) return result.ctx;
      }
      return {
        policyNumber: "",
        createdAt: "",
        snapshot: {} as Record<string, unknown> & { insuredSnapshot?: null; packagesSnapshot?: null },
        accountingLines: [],
      };
    })();

    const invoiceData: InvoiceContext = {
      invoiceNumber: invoice.invoiceNumber,
      invoiceDate: invoice.invoiceDate,
      dueDate: invoice.dueDate,
      totalAmountCents: invoice.totalAmountCents,
      paidAmountCents: invoice.paidAmountCents,
      currency: invoice.currency,
      status: invoice.status,
      entityName: invoice.entityName,
      entityType: invoice.entityType,
      premiumType: invoice.premiumType,
      direction: invoice.direction,
      invoiceType: invoice.invoiceType,
      periodStart: invoice.periodStart,
      periodEnd: invoice.periodEnd,
      notes: invoice.notes,
    };

    mergeCtx = { ...mergeCtx, invoiceData };

    try {
      const templateBytes = await readPdfTemplate(meta.filePath);
      const templateImages: PdfImageMapping[] = meta.images ?? [];
      const filledPdf = await generateFilledPdf(templateBytes, meta.fields, mergeCtx, {
        pages: meta.pages,
        images: templateImages,
        drawings: meta.drawings,
        loadImage: (storedName: string) => readPdfTemplate(storedName),
      });

      if (docType) {
        const existingStatus = (invoice.documentStatus as DocumentStatusMap | null) ?? {};
        const updated: DocumentStatusMap = {
          ...existingStatus,
          [docType]: {
            ...(existingStatus[docType] ?? {}),
            status: existingStatus[docType]?.status ?? "generated",
            generatedAt: new Date().toISOString(),
          } satisfies DocumentStatusEntry,
        };
        await db
          .update(accountingInvoices)
          .set({ documentStatus: updated, updatedAt: new Date().toISOString() })
          .where(eq(accountingInvoices.id, invoiceId));
      }

      const docLabel = tplRow.label || "Document";
      return new NextResponse(filledPdf as unknown as BodyInit, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${docLabel} - ${invoice.invoiceNumber}.pdf"`,
          "Cache-Control": "no-store",
        },
      });
    } catch (err) {
      console.error("PDF generation error:", err);
      return NextResponse.json(
        { error: "Failed to generate PDF" },
        { status: 500 },
      );
    }
  } catch (err) {
    console.error("POST /api/accounting/invoices/[id]/generate-pdf error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
