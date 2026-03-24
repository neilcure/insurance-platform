import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { accountingPayments, accountingInvoices } from "@/db/schema/accounting";
import { eq, sql } from "drizzle-orm";
import { requireUser } from "@/lib/auth/require-user";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const invoiceId = Number(id);
    const body = await request.json();

    const {
      amountCents,
      currency = "HKD",
      paymentDate,
      paymentMethod,
      referenceNumber,
      notes,
    } = body;

    if (!amountCents || amountCents <= 0) {
      return NextResponse.json({ error: "amountCents must be positive" }, { status: 400 });
    }

    const [invoice] = await db
      .select()
      .from(accountingInvoices)
      .where(eq(accountingInvoices.id, invoiceId))
      .limit(1);

    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    const isReceivable = invoice.direction === "receivable";

    const [payment] = await db
      .insert(accountingPayments)
      .values({
        invoiceId,
        amountCents: Math.round(Number(amountCents)),
        currency,
        paymentDate: paymentDate || null,
        paymentMethod: paymentMethod || null,
        referenceNumber: referenceNumber || null,
        status: isReceivable ? "submitted" : "recorded",
        notes: notes || null,
        submittedBy: Number(user.id),
      })
      .returning();

    if (!isReceivable) {
      await updateInvoicePaidAmount(invoiceId);
    }

    return NextResponse.json(payment, { status: 201 });
  } catch (err) {
    console.error("POST /api/accounting/invoices/[id]/payments error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

async function updateInvoicePaidAmount(invoiceId: number) {
  const result = await db
    .select({
      total: sql<number>`coalesce(sum(${accountingPayments.amountCents}), 0)::int`,
    })
    .from(accountingPayments)
    .where(eq(accountingPayments.invoiceId, invoiceId));

  const paidTotal = result[0]?.total ?? 0;

  const [invoice] = await db
    .select({ totalAmountCents: accountingInvoices.totalAmountCents })
    .from(accountingInvoices)
    .where(eq(accountingInvoices.id, invoiceId))
    .limit(1);

  let newStatus: string;
  if (paidTotal >= (invoice?.totalAmountCents ?? 0)) {
    newStatus = "paid";
  } else if (paidTotal > 0) {
    newStatus = "partial";
  } else {
    newStatus = "pending";
  }

  await db
    .update(accountingInvoices)
    .set({
      paidAmountCents: paidTotal,
      status: newStatus,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(accountingInvoices.id, invoiceId));
}
