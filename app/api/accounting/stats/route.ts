import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { accountingInvoices, accountingPayments } from "@/db/schema/accounting";
import { memberships } from "@/db/schema/core";
import { eq, sql, and, inArray, type SQL } from "drizzle-orm";
import { requireUser } from "@/lib/auth/require-user";
import {
  findPolicyIdsInStartMonth,
  buildInvoiceInPolicyIdsSql,
} from "@/lib/policies/policies-in-period";
import { excludeQuotationOnlyRows } from "@/lib/accounting-invoices";

export const dynamic = "force-dynamic";

/**
 * Accounting dashboard stats.
 *
 * Each metric is computed so the SAME accounting record is never counted
 * twice across its lifecycle (quotation → invoice → debit note → receipt
 * are ONE row in `accounting_invoices`; only `invoice_number` rotates).
 *
 * Direction is split — receivable (money in) and payable (money out)
 * are separate concerns and never share a card.
 *
 * Statement-bundled individuals (`status = 'statement_created'`) are
 * EXCLUDED from the per-row computation, because their `paid_amount_cents`
 * stays at 0 while the parent statement holds the truth. The parent
 * statement row is included instead, so each contribution is counted
 * exactly once.
 *
 * Per-row paid amounts are CAPPED at the row's total to prevent overpaid
 * rows from inflating the "Collected" or deflating the "Outstanding"
 * number. Overpayments are surfaced separately as `overpaidCents` so the
 * data integrity issue is visible instead of silently distorting totals.
 */
export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const url = new URL(request.url);

    // Month-tab filter: stat cards reflect ONLY records whose
    // underlying policy's start date falls in (startYear, startMonth).
    // Mirrors the same param contract used by /api/accounting/invoices.
    const startYearParam = url.searchParams.get("startYear");
    const startMonthParam = url.searchParams.get("startMonth");
    const hasMonthFilter =
      startYearParam !== null &&
      startMonthParam !== null &&
      Number.isFinite(Number(startYearParam)) &&
      Number.isFinite(Number(startMonthParam));

    // Admin-like users see tenant-wide totals; everyone else is scoped
    // to their org memberships. Mirrors `lib/auth/active-org.ts` `isAdminLike`
    // plus `accounting` (which the field-visibility-roles skill places in
    // the same elevated bucket — see SKILL §2 "sees everything").
    const isAdminLike =
      user.userType === "admin" ||
      user.userType === "internal_staff" ||
      user.userType === "accounting";

    const orgConditions: SQL[] = [];
    if (!isAdminLike) {
      const userMemberships = await db
        .select({ orgId: memberships.organisationId })
        .from(memberships)
        .where(eq(memberships.userId, Number(user.id)));
      const orgIds = userMemberships.map((m) => m.orgId);
      if (orgIds.length === 0) {
        return NextResponse.json(emptyStats());
      }
      orgConditions.push(inArray(accountingInvoices.organisationId, orgIds));
    }

    // Resolve the month-filter policy IDs ONCE and reuse for every
    // aggregation below so we hit the DB once for the policy scan.
    const monthFilterConditions: SQL[] = [];
    if (hasMonthFilter) {
      const policyIds = await findPolicyIdsInStartMonth(
        user,
        Number(startYearParam),
        Number(startMonthParam),
      );
      monthFilterConditions.push(buildInvoiceInPolicyIdsSql(policyIds));
    }

    // Status buckets we explicitly drop from money totals — they don't
    // represent open obligations or completed cash flow.
    const closedStatuses = sql`('cancelled', 'refunded')`;

    // Receivable summary — combine "individuals not bundled into a
    // statement" with "statement parents", so every contribution is
    // counted exactly once and the lifecycle (quotation → debit note →
    // receipt) collapses into the one underlying row.
    const receivableConditions = [
      eq(accountingInvoices.direction, "receivable"),
      sql`${accountingInvoices.status} NOT IN ${closedStatuses}`,
      // Bundled individuals: their `paid_amount_cents` stays at 0 while
      // the parent statement carries the money. Excluding here +
      // including the statement parent below avoids double-count.
      sql`NOT (${accountingInvoices.invoiceType} = 'individual' AND ${accountingInvoices.status} = 'statement_created')`,
      // Credit notes flow through their own card so they never
      // negate or inflate the regular receivable cards.
      sql`${accountingInvoices.invoiceType} <> 'credit_note'`,
      // Quotation-only rows are pre-sale, not real receivables.
      excludeQuotationOnlyRows,
      ...orgConditions,
      ...monthFilterConditions,
    ];

    // Payable summary — same shape as receivable, mirrored for the
    // money-out side (agent commission, refunds payable).
    const payableConditions = [
      eq(accountingInvoices.direction, "payable"),
      sql`${accountingInvoices.status} NOT IN ${closedStatuses}`,
      sql`NOT (${accountingInvoices.invoiceType} = 'individual' AND ${accountingInvoices.status} = 'statement_created')`,
      sql`${accountingInvoices.invoiceType} <> 'credit_note'`,
      excludeQuotationOnlyRows,
      ...orgConditions,
      ...monthFilterConditions,
    ];

    // Credit notes (refunds owed back to client) — surfaced as their own
    // card so the user can see "money we owe back" without it
    // distorting receivable totals.
    const creditNoteConditions = [
      eq(accountingInvoices.invoiceType, "credit_note"),
      sql`${accountingInvoices.status} NOT IN ${closedStatuses}`,
      excludeQuotationOnlyRows,
      ...orgConditions,
      ...monthFilterConditions,
    ];

    // SUM(LEAST(paid, total)) caps overpayments so they don't inflate
    // collected. SUM(GREATEST(total - paid, 0)) clamps outstanding to
    // non-negative so an overpaid row can't silently offset a different
    // row's real outstanding.
    //
    // The "overpaid" flag intentionally EXCLUDES rows where the client
    // paid admin directly. Per `.cursor/rules/insurance-platform-architecture.mdc`
    // "Payment paths (who pays admin)": when the client pays directly,
    // the receivable's total is `agentPremium` (net) and the payment
    // amount is `clientPremium` (full), so paid > total is BY DESIGN.
    // The architecture explicitly says "NEVER use invoice `entityType`
    // to determine who made a payment — use `accounting_payments.payer`",
    // which is what the NOT EXISTS subquery checks. Rejected/submitted
    // payments don't count — only verified/confirmed/recorded ones —
    // mirroring `accounting/invoices` row-level warning logic.
    const overpaidExcludingClientDirect = sql<number>`coalesce(sum(
      case
        when exists (
          select 1 from accounting_payments ap
          where ap.invoice_id = ${accountingInvoices.id}
            and ap.payer = 'client'
            and ap.status in ('verified', 'confirmed', 'recorded')
        ) then 0
        else greatest(${accountingInvoices.paidAmountCents} - ${accountingInvoices.totalAmountCents}, 0)
      end
    ), 0)::int`;

    const moneyAggregates = {
      billed: sql<number>`coalesce(sum(${accountingInvoices.totalAmountCents}), 0)::int`,
      collected: sql<number>`coalesce(sum(LEAST(${accountingInvoices.paidAmountCents}, ${accountingInvoices.totalAmountCents})), 0)::int`,
      outstanding: sql<number>`coalesce(sum(GREATEST(${accountingInvoices.totalAmountCents} - ${accountingInvoices.paidAmountCents}, 0)), 0)::int`,
      overpaid: overpaidExcludingClientDirect,
      count: sql<number>`count(*)::int`,
    };

    const [
      receivableRows,
      payableRows,
      creditNoteRows,
      pendingPayments,
      submittedInvoices,
      overdueInvoices,
      statusCounts,
    ] = await Promise.all([
      db
        .select(moneyAggregates)
        .from(accountingInvoices)
        .where(and(...receivableConditions)),

      db
        .select(moneyAggregates)
        .from(accountingInvoices)
        .where(and(...payableConditions)),

      db
        .select(moneyAggregates)
        .from(accountingInvoices)
        .where(and(...creditNoteConditions)),

      // Pending payments — JOIN to invoices so we can scope by org and
      // exclude payments on cancelled/refunded invoices (which the user
      // can't action from this page anyway). Quotation-only invoices
      // are also excluded — pre-sale rows don't get payments anyway.
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(accountingPayments)
        .innerJoin(
          accountingInvoices,
          eq(accountingInvoices.id, accountingPayments.invoiceId),
        )
        .where(
          and(
            eq(accountingPayments.status, "submitted"),
            sql`${accountingInvoices.status} NOT IN ${closedStatuses}`,
            excludeQuotationOnlyRows,
            ...orgConditions,
            ...monthFilterConditions,
          ),
        ),

      db
        .select({ count: sql<number>`count(*)::int` })
        .from(accountingInvoices)
        .where(and(
          eq(accountingInvoices.status, "submitted"),
          excludeQuotationOnlyRows,
          ...orgConditions,
          ...monthFilterConditions,
        )),

      db
        .select({ count: sql<number>`count(*)::int` })
        .from(accountingInvoices)
        .where(and(
          eq(accountingInvoices.status, "overdue"),
          excludeQuotationOnlyRows,
          ...orgConditions,
          ...monthFilterConditions,
        )),

      // Status counts cover the full picture (including statement_created
      // and credit_note) since this map is informational, not used in
      // the headline money math. Quotation-only rows are excluded so
      // these counts stay consistent with the list and money cards.
      db
        .select({
          status: accountingInvoices.status,
          count: sql<number>`count(*)::int`,
          totalCents: sql<number>`coalesce(sum(${accountingInvoices.totalAmountCents}), 0)::int`,
        })
        .from(accountingInvoices)
        .where(and(
          excludeQuotationOnlyRows,
          ...orgConditions,
          ...monthFilterConditions,
        ))
        .groupBy(accountingInvoices.status),
    ]);

    const invoicesByStatus: Record<string, { count: number; totalCents: number }> = {};
    for (const row of statusCounts) {
      invoicesByStatus[row.status] = { count: row.count, totalCents: row.totalCents };
    }

    const receivable = receivableRows[0] ?? zeroMoney();
    const payable = payableRows[0] ?? zeroMoney();
    const creditNote = creditNoteRows[0] ?? zeroMoney();

    return NextResponse.json({
      receivable: {
        billedCents: receivable.billed,
        collectedCents: receivable.collected,
        outstandingCents: receivable.outstanding,
        overpaidCents: receivable.overpaid,
        recordCount: receivable.count,
      },
      payable: {
        billedCents: payable.billed,
        collectedCents: payable.collected,
        outstandingCents: payable.outstanding,
        overpaidCents: payable.overpaid,
        recordCount: payable.count,
      },
      creditNote: {
        billedCents: creditNote.billed,
        collectedCents: creditNote.collected,
        outstandingCents: creditNote.outstanding,
        recordCount: creditNote.count,
      },
      pendingPaymentCount: pendingPayments[0]?.count ?? 0,
      pendingVerification: submittedInvoices[0]?.count ?? 0,
      overdue: overdueInvoices[0]?.count ?? 0,
      invoicesByStatus,

      // Legacy fields kept for callers that haven't migrated. These
      // mirror the new receivable bucket so existing UI isn't broken
      // mid-migration. New code should read from `receivable.*`.
      totalReceivableCents: receivable.billed,
      totalPaidCents: receivable.collected,
      totalOutstandingCents: receivable.outstanding,
      receivableCount: receivable.count,
    });
  } catch (err) {
    console.error("GET /api/accounting/stats error:", err);
    return NextResponse.json(emptyStats());
  }
}

function zeroMoney() {
  return { billed: 0, collected: 0, outstanding: 0, overpaid: 0, count: 0 };
}

function emptyStats() {
  const zero = { billedCents: 0, collectedCents: 0, outstandingCents: 0, overpaidCents: 0, recordCount: 0 };
  return {
    receivable: zero,
    payable: zero,
    creditNote: { billedCents: 0, collectedCents: 0, outstandingCents: 0, recordCount: 0 },
    pendingPaymentCount: 0,
    pendingVerification: 0,
    overdue: 0,
    invoicesByStatus: {},
    totalReceivableCents: 0,
    totalPaidCents: 0,
    totalOutstandingCents: 0,
    receivableCount: 0,
  };
}
