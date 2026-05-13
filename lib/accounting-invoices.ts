import { db } from "@/db/client";
import { accountingInvoices, accountingPayments, accountingInvoiceItems } from "@/db/schema/accounting";
import { eq, sql, and, inArray } from "drizzle-orm";
import { resolvePolicyPremiumSummary } from "@/lib/resolve-policy-agent";

const COUNTED_PAYMENT_STATUSES = ["recorded", "verified", "confirmed"] as const;

/**
 * Pure helper: returns TRUE if the lifecycle for a row is
 * "quotation-only" — i.e. only QUOTATION documents have been
 * issued, no invoice / debit note / credit note / receipt yet.
 *
 * Mirrors `lifecycleTagFromKey()` in the accounting page: a
 * trackingKey is treated as a QUOTATION when its name contains
 * `quotation` or `quote` (case-insensitive). A non-empty lifecycle
 * with at least one non-quotation key means the row IS a real
 * accounting record and must be kept.
 *
 * An empty lifecycle is NOT considered quotation-only (orphan /
 * legacy rows stay visible by default — safer).
 *
 * Used by `/api/accounting/invoices` to drop quotation-only rows
 * from the records list AFTER lifecycle has been built per row.
 */
export function isQuotationOnlyLifecycle(
  lifecycle: ReadonlyArray<{ trackingKey: string }>,
): boolean {
  if (lifecycle.length === 0) return false;
  return lifecycle.every((e) => {
    const k = e.trackingKey.toLowerCase();
    return k.includes("quotation") || k.includes("quote");
  });
}

/**
 * SQL fragment used by `/api/accounting/stats` to exclude the same
 * quotation-only rows from receivable / payable / credit-note money
 * totals, so the stat cards always agree with the records list.
 *
 * Detection rule: scan `policies.document_tracking` for the row's
 * set-code (the trailing `-<digits>(<letter>)?` group of
 * `invoice_number`). A row is dropped when:
 *   (a) at least one tracking entry with that set-code is a
 *       QUOTATION key (contains "quotation" / "quote"), AND
 *   (b) NO tracking entry with that set-code is a non-quotation key.
 *
 * Orphan rows (no tracking entry matching their set-code) are KEPT.
 *
 * The set-code regex `'-(\d+)(?:\([a-z]\))?$'` mirrors the
 * `extractSetCode()` JS helper used by the invoices route, so the
 * SQL filter agrees with the JS filter on what counts as a match.
 */
export const excludeQuotationOnlyRows = sql`(
  -- Keep if at least one non-quotation entry exists for this row's set-code
  EXISTS (
    SELECT 1
    FROM ${accountingInvoiceItems} ii
    JOIN policies p ON p.id = ii.policy_id
    CROSS JOIN LATERAL jsonb_each(coalesce(p.document_tracking, '{}'::jsonb)) AS kv(k, v)
    WHERE ii.invoice_id = ${accountingInvoices.id}
      AND left(kv.k, 1) <> '_'
      AND lower(kv.k) NOT LIKE '%quotation%'
      AND lower(kv.k) NOT LIKE '%quote%'
      AND substring(kv.v->>'documentNumber' from '-(\\d+)(?:\\([a-z]\\))?\\s*$')
        = substring(${accountingInvoices.invoiceNumber} from '-(\\d+)(?:\\([a-z]\\))?\\s*$')
  )
  -- ...or no entry for this set-code at all (orphan / legacy: keep)
  OR NOT EXISTS (
    SELECT 1
    FROM ${accountingInvoiceItems} ii
    JOIN policies p ON p.id = ii.policy_id
    CROSS JOIN LATERAL jsonb_each(coalesce(p.document_tracking, '{}'::jsonb)) AS kv(k, v)
    WHERE ii.invoice_id = ${accountingInvoices.id}
      AND left(kv.k, 1) <> '_'
      AND substring(kv.v->>'documentNumber' from '-(\\d+)(?:\\([a-z]\\))?\\s*$')
        = substring(${accountingInvoices.invoiceNumber} from '-(\\d+)(?:\\([a-z]\\))?\\s*$')
  )
)`;

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
