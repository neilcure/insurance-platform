import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { accountingInvoices } from "@/db/schema/accounting";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/require-user";
import { sendEmail } from "@/lib/email";
import type { DocumentStatusMap, DocumentStatusEntry, DocLifecycleStatus } from "@/lib/types/accounting";

export const dynamic = "force-dynamic";

type DocTypeKey = "quotation" | "invoice" | "receipt" | "statement";
const VALID_DOC_TYPES: DocTypeKey[] = ["quotation", "invoice", "receipt", "statement"];

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    await requireUser();
    const { id } = await ctx.params;
    const invoiceId = Number(id);

    const [invoice] = await db
      .select({ documentStatus: accountingInvoices.documentStatus })
      .from(accountingInvoices)
      .where(eq(accountingInvoices.id, invoiceId))
      .limit(1);

    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    return NextResponse.json(invoice.documentStatus ?? {});
  } catch (err) {
    console.error("GET document-status error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
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

    const { docType, action, sentTo, rejectionNote } = body as {
      docType: DocTypeKey;
      action: "send" | "confirm" | "reject";
      sentTo?: string;
      rejectionNote?: string;
    };

    if (!VALID_DOC_TYPES.includes(docType)) {
      return NextResponse.json({ error: "Invalid document type" }, { status: 400 });
    }

    const [invoice] = await db
      .select()
      .from(accountingInvoices)
      .where(eq(accountingInvoices.id, invoiceId))
      .limit(1);

    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    const existing = (invoice.documentStatus as DocumentStatusMap | null) ?? {};
    const entry = existing[docType] ?? {} as DocumentStatusEntry;

    let newStatus: DocLifecycleStatus;
    const now = new Date().toISOString();
    const currentStatus = entry.status;
    const blockedStatuses: DocLifecycleStatus[] = ["confirmed"];

    switch (action) {
      case "send":
        if (blockedStatuses.includes(currentStatus as DocLifecycleStatus)) {
          return NextResponse.json({ error: `Cannot send: already ${currentStatus}` }, { status: 400 });
        }
        newStatus = "sent";
        break;
      case "confirm":
        newStatus = "confirmed";
        break;
      case "reject":
        newStatus = "rejected";
        break;
      default:
        return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    const updatedEntry: DocumentStatusEntry = {
      ...entry,
      status: newStatus,
      ...(action === "send" && { sentAt: now, sentTo: sentTo || entry.sentTo }),
      ...(action === "confirm" && { confirmedAt: now }),
      ...(action === "reject" && { rejectedAt: now, rejectionNote: rejectionNote || undefined }),
    };

    const updatedMap: DocumentStatusMap = {
      ...existing,
      [docType]: updatedEntry,
    };

    await db
      .update(accountingInvoices)
      .set({ documentStatus: updatedMap, updatedAt: now })
      .where(eq(accountingInvoices.id, invoiceId));

    if (action === "send" && sentTo) {
      const docLabel = docType.charAt(0).toUpperCase() + docType.slice(1);
      const fmtAmount = new Intl.NumberFormat("en-HK", {
        style: "currency",
        currency: invoice.currency.toUpperCase(),
      }).format(invoice.totalAmountCents / 100);

      try {
        await sendEmail({
          to: sentTo,
          subject: `${docLabel} ${invoice.invoiceNumber} — ${fmtAmount}`,
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #1a1a1a; margin-bottom: 16px;">${docLabel} — ${invoice.invoiceNumber}</h2>
              <p style="color: #555; font-size: 14px;">Please find the ${docLabel.toLowerCase()} details below for <strong>${invoice.entityName || invoice.entityType}</strong>.</p>
              <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
                <tr>
                  <td style="padding: 8px 12px; border: 1px solid #e5e5e5; font-size: 13px; color: #888;">${docLabel} Number</td>
                  <td style="padding: 8px 12px; border: 1px solid #e5e5e5; font-size: 13px; font-weight: 600;">${invoice.invoiceNumber}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 12px; border: 1px solid #e5e5e5; font-size: 13px; color: #888;">Amount</td>
                  <td style="padding: 8px 12px; border: 1px solid #e5e5e5; font-size: 13px; font-weight: 600;">${fmtAmount}</td>
                </tr>
              </table>
              <p style="color: #999; font-size: 11px; margin-top: 24px;">This is an automated notification from your insurance platform.</p>
            </div>
          `,
          text: `${docLabel} ${invoice.invoiceNumber} for ${invoice.entityName || invoice.entityType}. Amount: ${fmtAmount}.`,
        });
      } catch (emailErr) {
        console.error("Failed to send document email:", emailErr);
      }
    }

    return NextResponse.json({ documentStatus: updatedMap });
  } catch (err) {
    console.error("POST document-status error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
