import { db } from "@/db/client";
import { accountingInvoices, accountingPayments } from "@/db/schema/accounting";
import { eq, sql } from "drizzle-orm";

const COUNTED_PAYMENT_STATUSES = ["recorded", "verified", "confirmed"] as const;

export async function syncInvoicePaymentStatus(invoiceId: number) {
  const [invoice] = await db
    .select({
      id: accountingInvoices.id,
      totalAmountCents: accountingInvoices.totalAmountCents,
    })
    .from(accountingInvoices)
    .where(eq(accountingInvoices.id, invoiceId))
    .limit(1);

  if (!invoice) return null;

  const [totals] = await db
    .select({
      total: sql<number>`coalesce(
        sum(
          case
            when ${accountingPayments.status} in ('recorded', 'verified', 'confirmed')
              then ${accountingPayments.amountCents}
            else 0
          end
        ),
        0
      )::int`,
    })
    .from(accountingPayments)
    .where(eq(accountingPayments.invoiceId, invoiceId));

  const paidTotal = totals?.total ?? 0;
  const newStatus =
    paidTotal >= (invoice.totalAmountCents ?? 0)
      ? "paid"
      : paidTotal > 0
        ? "partial"
        : "pending";

  await db
    .update(accountingInvoices)
    .set({
      paidAmountCents: paidTotal,
      status: newStatus,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(accountingInvoices.id, invoiceId));

  return {
    paidTotal,
    status: newStatus,
    countedStatuses: COUNTED_PAYMENT_STATUSES,
  };
}
