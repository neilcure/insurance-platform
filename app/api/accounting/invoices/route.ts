import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { accountingInvoices, accountingInvoiceItems, accountingPayments } from "@/db/schema/accounting";
import { memberships, organisations, clients, users } from "@/db/schema/core";
import { policies, cars } from "@/db/schema/insurance";
import { policyPremiums } from "@/db/schema/premiums";
import { and, desc, eq, sql, inArray, type SQL } from "drizzle-orm";
import { requireUser } from "@/lib/auth/require-user";
import { resolveInvoicePrefix } from "@/lib/resolve-prefix";
import { parsePaginationParams } from "@/lib/pagination/types";
import {
  findPolicyIdsInStartMonth,
  buildInvoiceInPolicyIdsSql,
} from "@/lib/policies/policies-in-period";
import { isQuotationOnlyLifecycle } from "@/lib/accounting-invoices";
import { getDisplayNameFromSnapshot } from "@/lib/field-resolver";
import { readVehicleRegistrationFromCar } from "@/lib/policies/vehicle-registration";
export const dynamic = "force-dynamic";

/**
 * Extract the document set-code suffix from an accounting record's
 * invoice number. e.g.
 *   "HIDIINV-2026-3389"      → "3389"
 *   "HIDIDEBT-2026-3389(a)"  → "3389"
 *   "DN-2026-6345"           → "6345"
 *   "AP-2026-1572"           → "1572"
 *
 * Used to find the lifecycle entries in `policies.documentTracking`
 * that share THIS row's set-code — those are the documents (quotation
 * → invoice → debit note → receipt) that all describe the SAME
 * underlying obligation, so they should render as one record's history,
 * not as separate records.
 */
function extractSetCode(invoiceNumber: string | null | undefined): string | null {
  if (!invoiceNumber) return null;
  const m = String(invoiceNumber).match(/-(\d+)(?:\([a-z]\))?\s*$/i);
  return m?.[1] ?? null;
}

type LifecycleEntry = {
  trackingKey: string;
  documentNumber: string;
  status: string | null;
  timestamp: string | null;
};

/**
 * Build a chronological list of every document generated for this
 * row's underlying obligation. Filters by set-code so a parent
 * policy's invoice/credit-note/debit-note rows each get only their
 * own lifecycle entries instead of all sharing the policy's full
 * documentTracking blob.
 */
function buildLifecycle(
  documentTracking: unknown,
  setCode: string | null,
): LifecycleEntry[] {
  if (!setCode || !documentTracking || typeof documentTracking !== "object") {
    return [];
  }
  const out: LifecycleEntry[] = [];
  for (const [key, raw] of Object.entries(documentTracking as Record<string, unknown>)) {
    if (key.startsWith("_")) continue;
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as {
      documentNumber?: string;
      status?: string;
      generatedAt?: string;
      sentAt?: string;
      confirmedAt?: string;
    };
    if (!entry.documentNumber) continue;
    const code = extractSetCode(entry.documentNumber);
    if (code !== setCode) continue;
    out.push({
      trackingKey: key,
      documentNumber: entry.documentNumber,
      status: entry.status ?? null,
      timestamp:
        entry.confirmedAt ?? entry.sentAt ?? entry.generatedAt ?? null,
    });
  }
  out.sort((a, b) => {
    if (!a.timestamp && !b.timestamp) return 0;
    if (!a.timestamp) return 1;
    if (!b.timestamp) return -1;
    return a.timestamp.localeCompare(b.timestamp);
  });
  return out;
}

type RowWarning = "overpaid" | "orphan_no_policy" | "status_mismatch";

/**
 * Per-row data integrity flags. Surfaced to the dashboard so the user
 * can see which rows are inconsistent without us silently distorting
 * money totals to mask them.
 *
 * IMPORTANT — "client paid directly" is NOT overpaid:
 * Per `.cursor/rules/insurance-platform-architecture.mdc`:
 *   • Receivable totalAmountCents on a policy with an agent is the
 *     `agentPremium` (NET that admin should collect from agent).
 *   • If the client pays admin directly, the payment is recorded
 *     against the SAME receivable with `accounting_payments.payer =
 *     'client'` and `amount = clientPremium`. The difference
 *     (`clientPremium − agentPremium`) is materialised as a SEPARATE
 *     payable invoice (the AP commission) — it is NOT a duplicate
 *     debt.
 *   • So `paid > total` on a client-direct receivable is BY DESIGN.
 * The architecture explicitly says "NEVER use invoice `entityType` to
 * determine who made a payment — use `accounting_payments.payer`".
 * That payer flag is what we read here.
 */
function computeWarnings(args: {
  totalAmountCents: number;
  paidAmountCents: number;
  status: string;
  policyId: number | null;
  wasClientPaidDirectly: boolean;
}): RowWarning[] {
  const out: RowWarning[] = [];
  // Suppress "overpaid" when the row is a client-direct receivable.
  // The overage is the agent commission, not a data error.
  if (args.paidAmountCents > args.totalAmountCents && !args.wasClientPaidDirectly) {
    out.push("overpaid");
  }
  if (!args.policyId) out.push("orphan_no_policy");
  // status='paid' but paid < total, or status='pending' but paid >= total.
  // `statement_created` intentionally has paid=0 (parent statement holds
  // the money) — that's not a mismatch. Client-direct rows are also not
  // a status mismatch when paid > total: cross-settle marks them paid.
  if (
    args.status === "paid" &&
    args.paidAmountCents < args.totalAmountCents
  ) {
    out.push("status_mismatch");
  } else if (
    args.status === "pending" &&
    args.totalAmountCents > 0 &&
    args.paidAmountCents >= args.totalAmountCents &&
    !args.wasClientPaidDirectly
  ) {
    out.push("status_mismatch");
  }
  return out;
}

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const url = new URL(request.url);
    const statusFilter = url.searchParams.get("status");
    const directionFilter = url.searchParams.get("direction");
    const entityTypeFilter = url.searchParams.get("entityType");
    const premiumTypeFilter = url.searchParams.get("premiumType");
    const flowFilter = url.searchParams.get("flow");
    const excludeStatementType = url.searchParams.get("excludeStatementType") === "1";
    // Month-tab filter: invoices whose underlying policy's start date
    // falls in the given (year, month). Resolves to a set of policy
    // IDs via the shared helper.
    const startYearParam = url.searchParams.get("startYear");
    const startMonthParam = url.searchParams.get("startMonth");
    const hasMonthFilter =
      startYearParam !== null &&
      startMonthParam !== null &&
      Number.isFinite(Number(startYearParam)) &&
      Number.isFinite(Number(startMonthParam));
    const { limit: qLimit, offset: qOffset } = parsePaginationParams(url.searchParams, {
      defaultLimit: 50,
      maxLimit: 500,
    });

    const conditions: SQL[] = [];
    if (statusFilter && statusFilter !== "all")
      conditions.push(eq(accountingInvoices.status, statusFilter));
    if (directionFilter) conditions.push(eq(accountingInvoices.direction, directionFilter));
    if (entityTypeFilter) conditions.push(eq(accountingInvoices.entityType, entityTypeFilter));
    if (premiumTypeFilter) conditions.push(eq(accountingInvoices.premiumType, premiumTypeFilter));
    // Caller can ask the API to drop statement-type rows so client-side
    // doesn't have to filter them out (which would corrupt pagination
    // counts). Used by /dashboard/accounting which only shows individual
    // invoices.
    if (excludeStatementType)
      conditions.push(sql`${accountingInvoices.invoiceType} <> 'statement'`);

    // Admin-like roles see tenant-wide data; everyone else is scoped
    // to their org memberships. This MUST match the same elevation rule
    // in `/api/accounting/stats` — otherwise the cards and the list
    // would disagree on which records exist.
    const isAdminLike =
      user.userType === "admin" ||
      user.userType === "internal_staff" ||
      user.userType === "accounting";

    let orgIds: number[] | null = null;
    if (!isAdminLike) {
      const userMemberships = await db
        .select({ orgId: memberships.organisationId })
        .from(memberships)
        .where(eq(memberships.userId, Number(user.id)));
      orgIds = userMemberships.map((m) => m.orgId);
      if (orgIds.length === 0) {
        return NextResponse.json(
          { rows: [], total: 0, limit: qLimit, offset: qOffset },
          { status: 200 },
        );
      }
      conditions.push(inArray(accountingInvoices.organisationId, orgIds));
    }

    // Apply flow filter as a SQL subquery so pagination works correctly
    if (flowFilter) {
      conditions.push(
        sql`${accountingInvoices.id} IN (
          SELECT ii.invoice_id FROM accounting_invoice_items ii
          INNER JOIN policies p ON p.id = ii.policy_id
          LEFT JOIN cars c ON c.policy_id = p.id
          WHERE (c.extra_attributes)::jsonb ->> 'flowKey' = ${flowFilter}
        )`
      );
    }

    // Month-tab filter: resolve which policies fall in (startYear, startMonth)
    // then constrain the invoice list to those linked to one of them.
    if (hasMonthFilter) {
      const policyIds = await findPolicyIdsInStartMonth(
        user,
        Number(startYearParam),
        Number(startMonthParam),
      );
      conditions.push(buildInvoiceInPolicyIdsSql(policyIds));
    }

    const includePayments = url.searchParams.get("includePayments") === "1";

    const whereExpr = conditions.length > 0 ? and(...conditions) : undefined;

    const [rawRows, totalRow] = await Promise.all([
      db
        .select()
        .from(accountingInvoices)
        .where(whereExpr)
        .orderBy(desc(accountingInvoices.createdAt))
        .limit(qLimit)
        .offset(qOffset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(accountingInvoices)
        .where(whereExpr),
    ]);
    const total = totalRow[0]?.count ?? 0;

    let rows: any[] = rawRows;

    if (rawRows.length > 0) {
      const ids = rawRows.map((r: any) => r.id as number);

      // Stage 1: premium aggregates, item→policy mapping, payer roll-up,
      // and (optional) payments all key off the same invoice-id list.
      // Fan them out in parallel.
      //
      // The payer roll-up runs UNCONDITIONALLY (not gated on
      // `includePayments`) because the warning logic and the "Client
      // paid directly" badge depend on it for every caller. It's a
      // tiny aggregate query (one row per invoice id) so the cost is
      // negligible compared to fetching full payment records.
      const [premiumRows, itemRows, payerRollup, paymentsRows] = await Promise.all([
        db
          .select({
            invoiceId: accountingInvoiceItems.invoiceId,
            totalNet: sql<number>`coalesce(sum(coalesce(${policyPremiums.netPremiumCents}, 0)), 0)::int`,
            totalAgent: sql<number>`coalesce(sum(coalesce(${policyPremiums.agentPremiumCents}, 0)), 0)::int`,
            totalClient: sql<number>`coalesce(sum(coalesce(${policyPremiums.clientPremiumCents}, 0)), 0)::int`,
          })
          .from(accountingInvoiceItems)
          .leftJoin(policyPremiums, eq(policyPremiums.id, accountingInvoiceItems.policyPremiumId))
          .where(inArray(accountingInvoiceItems.invoiceId, ids))
          .groupBy(accountingInvoiceItems.invoiceId),
        db
          .select({
            invoiceId: accountingInvoiceItems.invoiceId,
            policyId: accountingInvoiceItems.policyId,
          })
          .from(accountingInvoiceItems)
          .where(inArray(accountingInvoiceItems.invoiceId, ids)),
        // Roll-up of (verified/confirmed/recorded) payment payers per
        // invoice. We only count payments that actually count toward
        // the receivable balance — a rejected or submitted payment
        // shouldn't make us claim "client paid directly".
        db
          .select({
            invoiceId: accountingPayments.invoiceId,
            clientPayerCount: sql<number>`coalesce(sum(case when ${accountingPayments.payer} = 'client' and ${accountingPayments.status} in ('verified','confirmed','recorded') then 1 else 0 end), 0)::int`,
            clientPayerSubmittedCount: sql<number>`coalesce(sum(case when ${accountingPayments.payer} = 'client' and ${accountingPayments.status} = 'submitted' then 1 else 0 end), 0)::int`,
          })
          .from(accountingPayments)
          .where(inArray(accountingPayments.invoiceId, ids))
          .groupBy(accountingPayments.invoiceId),
        includePayments
          ? db
              .select()
              .from(accountingPayments)
              .where(inArray(accountingPayments.invoiceId, ids))
          : Promise.resolve([] as (typeof accountingPayments.$inferSelect)[]),
      ]);

      const premiumMap = new Map(premiumRows.map((r) => [r.invoiceId, r]));

      // Map: invoiceId → was client the payer of any "counted" payment.
      // Used to suppress the false "overpaid" warning on receivables
      // where the client paid admin directly (paid > total is by
      // design — the difference is the agent commission, materialised
      // as a separate payable invoice). See `computeWarnings`.
      const clientDirectMap = new Map<number, boolean>();
      const clientDirectPendingMap = new Map<number, boolean>();
      for (const r of payerRollup) {
        clientDirectMap.set(r.invoiceId, r.clientPayerCount > 0);
        clientDirectPendingMap.set(r.invoiceId, r.clientPayerSubmittedCount > 0);
      }

      rows = rawRows.map((r: any) => {
        const pm = premiumMap.get(r.id);
        const net = pm?.totalNet ?? 0;
        const agent = pm?.totalAgent ?? 0;
        const client = pm?.totalClient ?? 0;
        const gain = agent > 0 ? agent - net : client - net;
        return {
          ...r,
          totalGainCents: gain,
          totalNetPremiumCents: net,
        };
      });

      // Resolve all policy ids referenced by items and entityPolicyId fields.
      const policyIdSet = new Set(itemRows.map((r) => r.policyId));
      for (const r of rows) {
        if (r.entityPolicyId) policyIdSet.add(r.entityPolicyId as number);
      }
      const allPolicyIds = Array.from(policyIdSet);

      if (allPolicyIds.length > 0) {
        // Stage 2a: policy + endorsement-link lookup. The endorsement
        // link comes from `cars.extra_attributes.linkedPolicyId` (same
        // place `lib/auto-create-invoices.ts` and `lib/resolve-policy-agent.ts`
        // read it from). When set, this row's underlying policy is an
        // endorsement of the linked parent — the dashboard groups them
        // under that parent so a parent policy + its endorsements +
        // their commission payables all appear as ONE related cluster
        // instead of scattered "different documents".
        const [policyRows, carRows] = await Promise.all([
          db
            .select({
              id: policies.id,
              policyNumber: policies.policyNumber,
              clientId: policies.clientId,
              agentId: policies.agentId,
              flowKey: policies.flowKey,
              documentTracking: policies.documentTracking,
            })
            .from(policies)
            .where(inArray(policies.id, allPolicyIds)),
          db
            .select({
              policyId: cars.policyId,
              extraAttributes: cars.extraAttributes,
            })
            .from(cars)
            .where(inArray(cars.policyId, allPolicyIds)),
        ]);

        // For endorsements, also pull the parent policy's number so we
        // can render "Endorsement of POL-2026-…" without forcing the
        // frontend to do another roundtrip.
        const parentPolicyIdMap = new Map<number, number>();
        // Per-policy snapshot lookups for the human-friendly group
        // header on the dashboard: the insured display name + the
        // vehicle registration / plate. Sourced from `cars` so the
        // accounting list reads the same way as the policies list.
        const policyDisplayNameMap = new Map<number, string>();
        const policyVehicleRegMap = new Map<number, string>();
        // Cars are loaded for every policy in `allPolicyIds`, but
        // the `plateNumber` column is on `cars` itself — fetched
        // separately so the existing slim cars query doesn't have
        // to grow further.
        const carPlateMap = new Map<number, string | null>();
        for (const car of carRows) {
          const linked = (car.extraAttributes as Record<string, unknown> | null)?.linkedPolicyId;
          const linkedNum = Number(linked);
          if (Number.isFinite(linkedNum) && linkedNum > 0) {
            parentPolicyIdMap.set(car.policyId, linkedNum);
          }
          const extra = (car.extraAttributes as Record<string, unknown> | null) ?? null;
          if (extra) {
            const insuredSnapshot = extra.insuredSnapshot as Record<string, unknown> | null;
            const packagesSnapshot = extra.packagesSnapshot as Record<string, unknown> | null;
            const name = getDisplayNameFromSnapshot({
              insuredSnapshot,
              packagesSnapshot,
            });
            if (name) policyDisplayNameMap.set(car.policyId, name);
          }
        }
        // Fetch plate numbers in a tiny second query so we don't
        // bloat the cars SELECT used everywhere else in this route.
        if (allPolicyIds.length > 0) {
          const platesRows = await db
            .select({
              policyId: cars.policyId,
              plateNumber: cars.plateNumber,
            })
            .from(cars)
            .where(inArray(cars.policyId, allPolicyIds));
          for (const row of platesRows) {
            carPlateMap.set(row.policyId, row.plateNumber);
          }
        }
        // Combine cars.plateNumber + packagesSnapshot fallback per
        // the shared helper so we resolve the registration the same
        // way the policy list / statements do.
        for (const car of carRows) {
          const reg = readVehicleRegistrationFromCar(
            carPlateMap.get(car.policyId) ?? null,
            (car.extraAttributes as Record<string, unknown> | null) ?? null,
          );
          if (reg) policyVehicleRegMap.set(car.policyId, reg);
        }

        const parentIdsToFetch = Array.from(
          new Set(
            Array.from(parentPolicyIdMap.values()).filter(
              (id) => !allPolicyIds.includes(id),
            ),
          ),
        );

        const parentPolicyRows = parentIdsToFetch.length > 0
          ? await db
              .select({
                id: policies.id,
                policyNumber: policies.policyNumber,
              })
              .from(policies)
              .where(inArray(policies.id, parentIdsToFetch))
          : [];

        // Also resolve insured display name + registration for any
        // PARENT policy that wasn't already in `allPolicyIds` — the
        // group header on the frontend reads from the group root
        // (parent policy), so without this an endorsement-only set
        // would show an empty banner.
        if (parentIdsToFetch.length > 0) {
          const parentCars = await db
            .select({
              policyId: cars.policyId,
              plateNumber: cars.plateNumber,
              extraAttributes: cars.extraAttributes,
            })
            .from(cars)
            .where(inArray(cars.policyId, parentIdsToFetch));
          for (const car of parentCars) {
            const extra = (car.extraAttributes as Record<string, unknown> | null) ?? null;
            if (extra) {
              const insuredSnapshot = extra.insuredSnapshot as Record<string, unknown> | null;
              const packagesSnapshot = extra.packagesSnapshot as Record<string, unknown> | null;
              const name = getDisplayNameFromSnapshot({
                insuredSnapshot,
                packagesSnapshot,
              });
              if (name) policyDisplayNameMap.set(car.policyId, name);
            }
            const reg = readVehicleRegistrationFromCar(car.plateNumber, extra);
            if (reg) policyVehicleRegMap.set(car.policyId, reg);
          }
        }

        const parentNumberMap = new Map<number, string>();
        for (const p of policyRows) parentNumberMap.set(p.id, p.policyNumber);
        for (const p of parentPolicyRows) parentNumberMap.set(p.id, p.policyNumber);

        const clientIds = policyRows.map((p) => p.clientId).filter((id): id is number => id !== null);
        const agentIds = policyRows.map((p) => p.agentId).filter((id): id is number => id !== null);

        // Stage 3: clients + agents are independent — fan out in parallel.
        const [clientRows, agentRows] = await Promise.all([
          clientIds.length > 0
            ? db
                .select({ id: clients.id, displayName: clients.displayName })
                .from(clients)
                .where(inArray(clients.id, clientIds))
            : Promise.resolve([] as { id: number; displayName: string }[]),
          agentIds.length > 0
            ? db
                .select({ id: users.id, name: users.name, email: users.email })
                .from(users)
                .where(inArray(users.id, agentIds))
            : Promise.resolve([] as { id: number; name: string | null; email: string | null }[]),
        ]);

        const clientMap = new Map<number, string>();
        for (const c of clientRows) clientMap.set(c.id, c.displayName);
        const agentMap = new Map<number, string>();
        for (const a of agentRows) agentMap.set(a.id, a.name || a.email || "");

        const policyMap = new Map(policyRows.map((p) => [p.id, p]));

        const invoicePolicyMap = new Map<number, number>();
        for (const item of itemRows) {
          if (!invoicePolicyMap.has(item.invoiceId)) {
            invoicePolicyMap.set(item.invoiceId, item.policyId);
          }
        }

        rows = rows.map((r) => {
          const policyId = (invoicePolicyMap.get(r.id) ?? r.entityPolicyId) as number | null;
          const policy = policyId ? policyMap.get(policyId) : undefined;
          const tracking = policy?.documentTracking;

          // setCode for THIS row's invoiceNumber. The lifecycle is the
          // subset of policy.documentTracking entries whose own
          // documentNumber shares the same setCode — i.e. the documents
          // that all describe the SAME underlying obligation. This is
          // the fix the user asked for: one record's documents are
          // grouped together as that record's history, instead of being
          // shown as separate accounting records.
          const setCode = extractSetCode(r.invoiceNumber);
          const lifecycle = buildLifecycle(tracking, setCode);

          // Legacy `documentNumbers` map kept for callers (e.g. the
          // current dashboard) that still expect a flat object. New
          // surfaces should use `documentLifecycle` for the
          // chronological per-row history.
          const docNumbers: Record<string, string> = {};
          if (tracking && typeof tracking === "object") {
            for (const [key, entry] of Object.entries(tracking as Record<string, { documentNumber?: string }>)) {
              if (key.startsWith("_")) continue;
              if (entry?.documentNumber) docNumbers[key] = entry.documentNumber;
            }
          }

          const parentPolicyId = policyId ? parentPolicyIdMap.get(policyId) ?? null : null;
          const parentPolicyNumber = parentPolicyId
            ? parentNumberMap.get(parentPolicyId) ?? null
            : null;

          // Group key the frontend uses to cluster related rows under
          // the same parent policy header. When this row IS a parent
          // policy itself, its own policyId is the group root.
          const groupPolicyId = parentPolicyId ?? policyId ?? null;

          const wasClientPaidDirectly = clientDirectMap.get(r.id) ?? false;
          const hasClientDirectSubmitted = clientDirectPendingMap.get(r.id) ?? false;

          return {
            ...r,
            policyId,
            policyNumber: policy?.policyNumber ?? null,
            flowKey: policy?.flowKey ?? null,
            clientName: policy?.clientId ? (clientMap.get(policy.clientId) ?? null) : null,
            agentName: policy?.agentId ? (agentMap.get(policy.agentId) ?? null) : null,
            documentNumbers: Object.keys(docNumbers).length > 0 ? docNumbers : null,
            documentLifecycle: lifecycle,
            setCode,
            parentPolicyId,
            parentPolicyNumber,
            // Human-friendly identity from the snapshot — surfaced
            // here so dashboard surfaces don't have to fan out
            // additional `/api/policies/:id` calls just to render
            // "John Chan · AB1234" next to a policy number.
            insuredDisplayName: policyId ? (policyDisplayNameMap.get(policyId) ?? null) : null,
            vehicleRegistration: policyId ? (policyVehicleRegMap.get(policyId) ?? null) : null,
            parentInsuredDisplayName: parentPolicyId
              ? (policyDisplayNameMap.get(parentPolicyId) ?? null)
              : null,
            parentVehicleRegistration: parentPolicyId
              ? (policyVehicleRegMap.get(parentPolicyId) ?? null)
              : null,
            groupPolicyId,
            isEndorsement: parentPolicyId !== null,
            wasClientPaidDirectly,
            hasClientDirectSubmitted,
            warnings: computeWarnings({
              totalAmountCents: Number(r.totalAmountCents) || 0,
              paidAmountCents: Number(r.paidAmountCents) || 0,
              status: String(r.status ?? ""),
              policyId,
              wasClientPaidDirectly,
            }),
          };
        });
      } else {
        // No related policies — still flag orphan rows so the dashboard
        // can show "this row has no policy" warning instead of silently
        // displaying blank metadata.
        rows = rows.map((r) => {
          const wasClientPaidDirectly = clientDirectMap.get(r.id) ?? false;
          const hasClientDirectSubmitted = clientDirectPendingMap.get(r.id) ?? false;
          return {
            ...r,
            policyId: null,
            policyNumber: null,
            flowKey: null,
            clientName: null,
            agentName: null,
            documentNumbers: null,
            documentLifecycle: [] as LifecycleEntry[],
            setCode: extractSetCode(r.invoiceNumber),
            parentPolicyId: null,
            parentPolicyNumber: null,
            insuredDisplayName: null,
            vehicleRegistration: null,
            parentInsuredDisplayName: null,
            parentVehicleRegistration: null,
            groupPolicyId: null,
            isEndorsement: false,
            wasClientPaidDirectly,
            hasClientDirectSubmitted,
            warnings: computeWarnings({
              totalAmountCents: Number(r.totalAmountCents) || 0,
              paidAmountCents: Number(r.paidAmountCents) || 0,
              status: String(r.status ?? ""),
              policyId: null,
              wasClientPaidDirectly,
            }),
          };
        });
      }

      // Apply payments (already pre-fetched in Stage 1 when includePayments was set).
      if (includePayments) {
        const paymentsByInvoice = new Map<number, (typeof paymentsRows)[number][]>();
        for (const p of paymentsRows) {
          const arr = paymentsByInvoice.get(p.invoiceId) ?? [];
          arr.push(p);
          paymentsByInvoice.set(p.invoiceId, arr);
        }
        rows = rows.map((r) => ({
          ...r,
          payments: paymentsByInvoice.get(r.id) ?? [],
        }));
      }
    }

    // Hide rows that are still in the QUOTATION-only phase — they're
    // pre-sale proposals, not accounting records yet. We do this
    // AFTER lifecycle has been built (above) so the filter uses the
    // exact same trackingKey rule as the UI's `lifecycleTagFromKey`.
    // The companion SQL fragment in `/api/accounting/stats` keeps
    // money totals consistent with this list.
    const beforeFilter = rows.length;
    rows = rows.filter((r) =>
      !isQuotationOnlyLifecycle(
        (r.documentLifecycle as ReadonlyArray<{ trackingKey: string }>) ?? [],
      ),
    );
    const filteredOut = beforeFilter - rows.length;
    const finalTotal = Math.max(0, total - filteredOut);

    return NextResponse.json(
      { rows, total: finalTotal, limit: qLimit, offset: qOffset },
      { status: 200 },
    );
  } catch (err) {
    console.error("GET /api/accounting/invoices error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = await request.json();

    const {
      invoiceType = "individual",
      direction,
      premiumType,
      entityPolicyId,
      entityType,
      entityName,
      currency = "HKD",
      invoiceDate,
      dueDate,
      notes,
      items,
      parentInvoiceId,
      scheduleId,
    } = body;

    if (!direction || !premiumType || !entityType) {
      return NextResponse.json(
        { error: "direction, premiumType, and entityType are required" },
        { status: 400 },
      );
    }

    let organisationId: number;
    const [firstMembership] = await db
      .select({ orgId: memberships.organisationId })
      .from(memberships)
      .where(eq(memberships.userId, Number(user.id)))
      .limit(1);
    organisationId = firstMembership?.orgId ?? 0;
    if (!organisationId) {
      const [firstOrg] = await db.select({ id: organisations.id }).from(organisations).limit(1);
      organisationId = firstOrg?.id ?? 0;
    }
    if (!organisationId) {
      return NextResponse.json({ error: "No organisation found" }, { status: 400 });
    }

    const invoiceNumber = await generateInvoiceNumber(organisationId, direction, invoiceType);

    let totalAmountCents = 0;
    const parsedItems: Array<{ policyId: number; policyPremiumId?: number; lineKey?: string; amountCents: number; description?: string }> = [];

    if (Array.isArray(items) && items.length > 0) {
      for (const item of items) {
        const amt = Math.round(Number(item.amountCents) || 0);
        totalAmountCents += amt;
        parsedItems.push({
          policyId: Number(item.policyId),
          policyPremiumId: item.policyPremiumId ? Number(item.policyPremiumId) : undefined,
          lineKey: item.lineKey || undefined,
          amountCents: amt,
          description: item.description || undefined,
        });
      }
    }

    const result = await db.transaction(async (tx) => {
      const [invoice] = await tx
        .insert(accountingInvoices)
        .values({
          organisationId,
          invoiceNumber,
          invoiceType,
          direction,
          premiumType,
          entityPolicyId: entityPolicyId ? Number(entityPolicyId) : null,
          entityType,
          entityName: entityName || null,
          scheduleId: scheduleId ? Number(scheduleId) : null,
          parentInvoiceId: parentInvoiceId ? Number(parentInvoiceId) : null,
          totalAmountCents,
          paidAmountCents: 0,
          currency,
          invoiceDate: invoiceDate || null,
          dueDate: dueDate || null,
          status: "draft",
          notes: notes || null,
          createdBy: Number(user.id),
        })
        .returning();

      if (parsedItems.length > 0) {
        await tx.insert(accountingInvoiceItems).values(
          parsedItems.map((item) => ({
            invoiceId: invoice.id,
            policyId: item.policyId,
            policyPremiumId: item.policyPremiumId ?? null,
            lineKey: item.lineKey ?? null,
            amountCents: item.amountCents,
            description: item.description ?? null,
          })),
        );
      }

      return invoice;
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    console.error("POST /api/accounting/invoices error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

async function generateInvoiceNumber(
  orgId: number,
  direction: string,
  invoiceType: string,
): Promise<string> {
  const prefix = await resolveInvoicePrefix(invoiceType, direction);
  const year = new Date().getFullYear();
  const countResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(accountingInvoices)
    .where(
      and(
        eq(accountingInvoices.organisationId, orgId),
        sql`extract(year from ${accountingInvoices.createdAt}) = ${year}`,
      ),
    );
  const count = (countResult[0]?.count ?? 0) + 1;
  return `${prefix}-${year}-${String(count).padStart(4, "0")}`;
}
