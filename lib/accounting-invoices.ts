import { db } from "@/db/client";
import { accountingInvoices, accountingPayments, accountingInvoiceItems } from "@/db/schema/accounting";
import { eq, sql, and, inArray } from "drizzle-orm";
import { resolvePolicyPremiumSummary } from "@/lib/resolve-policy-agent";

const COUNTED_PAYMENT_STATUSES = ["recorded", "verified", "confirmed"] as const;

export async function syncInvoicePaymentStatus(invoiceId: number) {
  const [invoice] = await db
    .select({
      id: accountingInvoices.id,
      totalAmountCents: accountingInvoices.totalAmountCents,
      entityPolicyId: accountingInvoices.entityPolicyId,
      direction: accountingInvoices.direction,
      scheduleId: accountingInvoices.scheduleId,
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

  let effectiveTotal = invoice.totalAmountCents ?? 0;

  if (invoice.direction === "receivable" && invoice.entityPolicyId && paidTotal < effectiveTotal && paidTotal > 0) {
    const agentPaidOnThisInvoice = await getAgentPaidAmount(invoiceId);
    if (agentPaidOnThisInvoice > 0) {
      const summary = await resolvePolicyPremiumSummary(invoice.entityPolicyId);
      if (summary && summary.agentPremiumCents > 0 && agentPaidOnThisInvoice >= summary.agentPremiumCents) {
        effectiveTotal = paidTotal;
      }
    }
  }

  const isOnStatement = !!invoice.scheduleId;

  const newStatus = paidTotal >= effectiveTotal && effectiveTotal > 0
    ? "paid"
    : isOnStatement
      ? "statement_created"
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

async function getAgentPaidAmount(invoiceId: number): Promise<number> {
  const [result] = await db
    .select({
      total: sql<number>`coalesce(
        sum(
          case
            when ${accountingPayments.status} in ('recorded', 'verified', 'confirmed')
              and ${accountingPayments.payer} = 'agent'
              then ${accountingPayments.amountCents}
            else 0
          end
        ),
        0
      )::int`,
    })
    .from(accountingPayments)
    .where(eq(accountingPayments.invoiceId, invoiceId));
  return result?.total ?? 0;
}

/**
 * After a payment is recorded on a receivable, check if the policy is fully settled
 * and handle cross-settlement of any related payable invoices.
 * 
 * When client pays: commission AP is created separately via createAgentCommissionPayable.
 * When agent pays their full agent premium: the receivable is settled (agent keeps commission).
 * In both cases, any outstanding payable (AP) for the same policy should be settled.
 */
export async function crossSettlePolicyInvoices(policyId: number, payer: string | null) {
  const itemRows = await db
    .select({ invoiceId: accountingInvoiceItems.invoiceId })
    .from(accountingInvoiceItems)
    .where(eq(accountingInvoiceItems.policyId, policyId));

  const invoiceIds = [...new Set(itemRows.map((r) => r.invoiceId))];
  if (invoiceIds.length === 0) return;

  const invoices = await db
    .select()
    .from(accountingInvoices)
    .where(
      and(
        inArray(accountingInvoices.id, invoiceIds),
        sql`${accountingInvoices.status} <> 'cancelled'`,
      ),
    );

  const receivables = invoices.filter((inv) => inv.direction === "receivable");

  const receivableSettled = receivables.every((inv) => inv.status === "paid");

  if (receivableSettled && payer === "agent") {
    const payables = invoices.filter(
      (inv) => inv.direction === "payable" && inv.entityType === "agent" && inv.status !== "paid" && inv.status !== "cancelled",
    );
    for (const payable of payables) {
      await db
        .update(accountingInvoices)
        .set({
          paidAmountCents: payable.totalAmountCents,
          status: "paid",
          notes: payable.notes ? `${payable.notes} · Settled (agent paid directly)` : "Settled (agent paid directly)",
          updatedAt: new Date().toISOString(),
        })
        .where(eq(accountingInvoices.id, payable.id));
    }
  }
}
