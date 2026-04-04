import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { accountingInvoices, accountingPayments, accountingInvoiceItems } from "@/db/schema/accounting";
import { eq, inArray } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  const policyIds = [343, 345];
  const items = await db
    .select({ invoiceId: accountingInvoiceItems.invoiceId, policyId: accountingInvoiceItems.policyId })
    .from(accountingInvoiceItems)
    .where(inArray(accountingInvoiceItems.policyId, policyIds));

  const invoiceIds = [...new Set(items.map((i) => i.invoiceId))];

  const invoices = invoiceIds.length > 0
    ? await db.select().from(accountingInvoices).where(inArray(accountingInvoices.id, invoiceIds))
    : [];

  const payments = invoiceIds.length > 0
    ? await db.select().from(accountingPayments).where(inArray(accountingPayments.invoiceId, invoiceIds))
    : [];

  return NextResponse.json({
    invoiceItems: items,
    invoices: invoices.map((inv) => ({
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      invoiceType: inv.invoiceType,
      direction: inv.direction,
      status: inv.status,
      totalAmountCents: inv.totalAmountCents,
      paidAmountCents: inv.paidAmountCents,
      premiumType: inv.premiumType,
      entityType: inv.entityType,
      entityName: inv.entityName,
      scheduleId: inv.scheduleId,
      notes: inv.notes,
    })),
    payments: payments.map((p) => ({
      id: p.id,
      invoiceId: p.invoiceId,
      amountCents: p.amountCents,
      payer: p.payer,
      status: p.status,
      paymentMethod: p.paymentMethod,
      paymentDate: p.paymentDate,
      createdAt: p.createdAt,
    })),
  });
}
