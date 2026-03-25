import { NextResponse } from "next/server";
import { db } from "@/db/client";
import {
  accountingInvoices,
  accountingInvoiceItems,
} from "@/db/schema/accounting";
import { eq, and, sql } from "drizzle-orm";
import { requireUser } from "@/lib/auth/require-user";

export const dynamic = "force-dynamic";

/**
 * POST /api/accounting/invoices/[id]/credit-note
 *
 * Creates a credit note (reverse invoice) linked to the original invoice.
 * Supports full or partial refund with optional pro-rata calculation.
 *
 * Body:
 *   refundAmountCents: number    – Total credit note amount (positive value)
 *   cancellationDate?: string    – Date of policy cancellation
 *   refundReason?: string        – Reason for the refund
 *   items?: Array<{ policyId, policyPremiumId?, lineKey?, amountCents, description? }>
 *          – Override individual line items (optional; if omitted, mirrors original items proportionally)
 */
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const parentInvoiceId = Number(id);

    const body = await request.json();
    const {
      refundAmountCents,
      cancellationDate,
      refundReason,
      items: overrideItems,
    } = body;

    if (!refundAmountCents || refundAmountCents <= 0) {
      return NextResponse.json(
        { error: "refundAmountCents must be a positive number" },
        { status: 400 },
      );
    }

    const [parentInvoice] = await db
      .select()
      .from(accountingInvoices)
      .where(eq(accountingInvoices.id, parentInvoiceId))
      .limit(1);

    if (!parentInvoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    if (parentInvoice.invoiceType === "credit_note") {
      return NextResponse.json(
        { error: "Cannot create a credit note from another credit note" },
        { status: 400 },
      );
    }

    if (refundAmountCents > parentInvoice.totalAmountCents) {
      return NextResponse.json(
        { error: "Refund amount cannot exceed the original invoice total" },
        { status: 400 },
      );
    }

    const reverseDirection =
      parentInvoice.direction === "payable" ? "receivable" : "payable";

    const cnNumber = await generateCreditNoteNumber(parentInvoice.organisationId);

    const originalItems = await db
      .select()
      .from(accountingInvoiceItems)
      .where(eq(accountingInvoiceItems.invoiceId, parentInvoiceId));

    let creditItems: Array<{
      policyId: number;
      policyPremiumId: number | null;
      lineKey: string | null;
      amountCents: number;
      description: string | null;
    }>;

    if (Array.isArray(overrideItems) && overrideItems.length > 0) {
      creditItems = overrideItems.map((item: any) => ({
        policyId: Number(item.policyId),
        policyPremiumId: item.policyPremiumId
          ? Number(item.policyPremiumId)
          : null,
        lineKey: item.lineKey || null,
        amountCents: Math.round(Number(item.amountCents) || 0),
        description:
          item.description || `Credit: ${item.lineKey || "refund"}`,
      }));
    } else {
      const originalTotal = originalItems.reduce(
        (s, it) => s + it.amountCents,
        0,
      );
      const ratio =
        originalTotal > 0 ? refundAmountCents / originalTotal : 1;

      creditItems = originalItems.map((item) => ({
        policyId: item.policyId,
        policyPremiumId: item.policyPremiumId,
        lineKey: item.lineKey,
        amountCents: Math.round(item.amountCents * ratio),
        description: `Credit: ${item.description || item.lineKey || "refund"}`,
      }));

      const itemsTotal = creditItems.reduce((s, it) => s + it.amountCents, 0);
      const diff = refundAmountCents - itemsTotal;
      if (diff !== 0 && creditItems.length > 0) {
        creditItems[0].amountCents += diff;
      }
    }

    const result = await db.transaction(async (tx) => {
      const [creditNote] = await tx
        .insert(accountingInvoices)
        .values({
          organisationId: parentInvoice.organisationId,
          invoiceNumber: cnNumber,
          invoiceType: "credit_note",
          direction: reverseDirection,
          premiumType: parentInvoice.premiumType,
          entityPolicyId: parentInvoice.entityPolicyId,
          entityType: parentInvoice.entityType,
          entityName: parentInvoice.entityName,
          scheduleId: parentInvoice.scheduleId,
          parentInvoiceId,
          totalAmountCents: refundAmountCents,
          paidAmountCents: 0,
          currency: parentInvoice.currency,
          invoiceDate: new Date().toISOString().slice(0, 10),
          cancellationDate: cancellationDate || null,
          refundReason: refundReason || null,
          status: "draft",
          notes: `Credit note for ${parentInvoice.invoiceNumber}${refundReason ? ` — ${refundReason}` : ""}`,
          createdBy: Number(user.id),
        })
        .returning();

      if (creditItems.length > 0) {
        await tx.insert(accountingInvoiceItems).values(
          creditItems.map((item) => ({
            invoiceId: creditNote.id,
            policyId: item.policyId,
            policyPremiumId: item.policyPremiumId,
            lineKey: item.lineKey,
            amountCents: item.amountCents,
            description: item.description,
          })),
        );
      }

      await tx
        .update(accountingInvoices)
        .set({
          status: "refunded",
          cancellationDate: cancellationDate || null,
          refundReason: refundReason || null,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(accountingInvoices.id, parentInvoiceId));

      return creditNote;
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    console.error(
      "POST /api/accounting/invoices/[id]/credit-note error:",
      err,
    );
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

async function generateCreditNoteNumber(orgId: number): Promise<string> {
  const prefix = "CN";
  const year = new Date().getFullYear();
  const countResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(accountingInvoices)
    .where(
      and(
        eq(accountingInvoices.organisationId, orgId),
        eq(accountingInvoices.invoiceType, "credit_note"),
        sql`extract(year from ${accountingInvoices.createdAt}) = ${year}`,
      ),
    );
  const count = (countResult[0]?.count ?? 0) + 1;
  return `${prefix}-${year}-${String(count).padStart(4, "0")}`;
}
