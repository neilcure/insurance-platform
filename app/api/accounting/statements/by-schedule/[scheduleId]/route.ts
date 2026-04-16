import { NextResponse } from "next/server";
import { db } from "@/db/client";
import {
  accountingInvoices,
  accountingPaymentSchedules,
} from "@/db/schema/accounting";
import { policyPremiums } from "@/db/schema/premiums";
import { policies } from "@/db/schema/insurance";
import { cars } from "@/db/schema/insurance";
import { clients } from "@/db/schema/core";
import { eq, and, sql, inArray } from "drizzle-orm";
import { requireUser } from "@/lib/auth/require-user";
import { loadAccountingFields } from "@/lib/accounting-fields";
import { resolvePremiumByRole } from "@/lib/resolve-policy-agent";

export const dynamic = "force-dynamic";

type ItemResult = {
  id: number;
  policyId: number;
  policyPremiumId: number | null;
  amountCents: number;
  description: string | null;
  status: string;
};

function isCommissionOrCreditItem(item: ItemResult) {
  const desc = String(item.description ?? "").trim().toLowerCase();
  return desc.includes("commission:") || desc.includes("credit:");
}

function resolveDisplayedItemAmountCents(
  item: ItemResult,
  entityType: string,
  premiumRoleTotals: Map<number, { clientCents: number; agentCents: number }>,
) {
  if (isCommissionOrCreditItem(item)) return item.amountCents;
  if (!item.policyPremiumId) return item.amountCents;
  const totals = premiumRoleTotals.get(item.policyPremiumId);
  if (entityType === "agent") return totals?.agentCents || item.amountCents;
  if (entityType === "client") return totals?.clientCents || item.amountCents;
  return item.amountCents;
}

export async function GET(
  request: Request,
  ctx: { params: Promise<{ scheduleId: string }> },
) {
  try {
    await requireUser();
    const { scheduleId } = await ctx.params;
    const sid = Number(scheduleId);
    if (!Number.isFinite(sid) || sid <= 0) {
      return NextResponse.json({ error: "Invalid scheduleId" }, { status: 400 });
    }

    const url = new URL(request.url);
    const audience = url.searchParams.get("audience") ?? "agent";

    const [schedule] = await db
      .select({
        id: accountingPaymentSchedules.id,
        entityType: accountingPaymentSchedules.entityType,
      })
      .from(accountingPaymentSchedules)
      .where(eq(accountingPaymentSchedules.id, sid))
      .limit(1);
    if (!schedule) {
      return NextResponse.json({ statement: null });
    }

    const effectiveEntityType = audience;

    const [stmtInvoice] = await db
      .select({
        id: accountingInvoices.id,
        invoiceNumber: accountingInvoices.invoiceNumber,
        status: accountingInvoices.status,
        totalAmountCents: accountingInvoices.totalAmountCents,
        paidAmountCents: accountingInvoices.paidAmountCents,
        currency: accountingInvoices.currency,
        entityType: accountingInvoices.entityType,
        entityName: accountingInvoices.entityName,
        invoiceDate: accountingInvoices.invoiceDate,
        direction: accountingInvoices.direction,
      })
      .from(accountingInvoices)
      .where(
        and(
          eq(accountingInvoices.scheduleId, sid),
          eq(accountingInvoices.invoiceType, "statement"),
          inArray(accountingInvoices.status, [
            "draft", "pending", "partial", "settled", "active",
            "statement_created", "statement_sent", "statement_confirmed",
          ]),
        ),
      )
      .orderBy(sql`${accountingInvoices.id} DESC`)
      .limit(1);

    let stmtItems: ItemResult[] = [];
    if (stmtInvoice) {
      const rawItems = await db.execute(sql`
        SELECT "id", "policy_id", "policy_premium_id", "amount_cents",
               "description", coalesce("status", 'active') AS "status"
        FROM "accounting_invoice_items"
        WHERE "invoice_id" = ${stmtInvoice.id}
        ORDER BY "id"
      `);
      const rawRows = Array.isArray(rawItems)
        ? rawItems
        : (rawItems as { rows?: unknown[] }).rows ?? [];
      const rawMapped = (rawRows as {
        id: number; policy_id: number; policy_premium_id: number | null;
        amount_cents: number; description: string | null; status: string;
      }[]).map((r) => ({
        id: r.id, policyId: r.policy_id, policyPremiumId: r.policy_premium_id,
        amountCents: r.amount_cents, description: r.description, status: r.status,
      }));

      const seenPremIds = new Set<number>();
      stmtItems = rawMapped.filter((it) => {
        if (!it.policyPremiumId) return true;
        const d = String(it.description ?? "").toLowerCase();
        if (d.includes("commission:") || d.includes("credit:")) return true;
        if (seenPremIds.has(it.policyPremiumId)) return false;
        seenPremIds.add(it.policyPremiumId);
        return true;
      });
    }

    const existingPremiumPolicyIds = new Set(
      stmtItems.filter((it) => !isCommissionOrCreditItem(it)).map((it) => it.policyId),
    );

    const schedInvs = await db
      .select({ id: accountingInvoices.id })
      .from(accountingInvoices)
      .where(
        and(
          eq(accountingInvoices.scheduleId, sid),
          eq(accountingInvoices.invoiceType, "individual"),
          inArray(accountingInvoices.status, [
            "draft", "pending", "partial", "settled", "active",
            "statement_created", "statement_sent", "statement_confirmed",
            "paid",
          ]),
        ),
      );

    const schedInvIds = schedInvs.map((r) => r.id);
    let schedItems: ItemResult[] = [];
    if (schedInvIds.length > 0) {
      const schedItemsRaw = await db.execute(sql`
        SELECT "id", "policy_id", "policy_premium_id", "amount_cents",
               "description", coalesce("status", 'active') AS "status"
        FROM "accounting_invoice_items"
        WHERE "invoice_id" IN (${sql.join(schedInvIds.map((id) => sql`${id}`), sql`,`)})
        ORDER BY "id"
      `);
      const schedRows = Array.isArray(schedItemsRaw)
        ? schedItemsRaw
        : (schedItemsRaw as { rows?: unknown[] }).rows ?? [];
      schedItems = (schedRows as {
        id: number; policy_id: number; policy_premium_id: number | null;
        amount_cents: number; description: string | null; status: string;
      }[]).map((r) => ({
        id: r.id, policyId: r.policy_id, policyPremiumId: r.policy_premium_id,
        amountCents: r.amount_cents, description: r.description, status: r.status,
      }));
    }

    const seenPremiumIds = new Set<number>();
    for (const it of stmtItems) {
      if (it.policyPremiumId && !isCommissionOrCreditItem(it)) {
        seenPremiumIds.add(it.policyPremiumId);
      }
    }

    const seenCommPremIds = new Set<number>();
    for (const it of stmtItems) {
      if (it.policyPremiumId && isCommissionOrCreditItem(it)) {
        seenCommPremIds.add(it.policyPremiumId);
      }
    }

    const allItems = [...stmtItems];
    for (const it of schedItems) {
      if (isCommissionOrCreditItem(it)) {
        if (it.policyPremiumId && seenCommPremIds.has(it.policyPremiumId)) continue;
        if (it.policyPremiumId) seenCommPremIds.add(it.policyPremiumId);
        allItems.push(it);
        continue;
      }
      if (existingPremiumPolicyIds.has(it.policyId)) continue;
      if (it.policyPremiumId && seenPremiumIds.has(it.policyPremiumId)) continue;
      if (it.policyPremiumId) seenPremiumIds.add(it.policyPremiumId);
      allItems.push(it);
    }

    // Pull in premium items for client-paid policies that only have commission
    // items on the schedule (their receivable invoices may not be on the schedule).
    const commissionOnlyPolicyIds = [
      ...new Set(
        allItems
          .filter((it) => isCommissionOrCreditItem(it))
          .map((it) => it.policyId)
          .filter((pid) => !existingPremiumPolicyIds.has(pid) && !allItems.some((a) => a.policyId === pid && !isCommissionOrCreditItem(a))),
      ),
    ].filter((id) => Number.isFinite(id) && id > 0);

    if (commissionOnlyPolicyIds.length > 0) {
      const offSchedItems = await db.execute(sql`
        SELECT ii."id", ii."policy_id", ii."policy_premium_id", ii."amount_cents",
               ii."description", 'paid_individually' AS "status"
        FROM "accounting_invoice_items" ii
        INNER JOIN "accounting_invoices" ai ON ai."id" = ii."invoice_id"
        WHERE ii."policy_id" IN (${sql.join(commissionOnlyPolicyIds.map((id) => sql`${id}`), sql`,`)})
          AND ai."invoice_type" = 'individual'
          AND ai."direction" = 'receivable'
          AND ai."entity_type" = 'agent'
          AND ai."status" <> 'cancelled'
          AND lower(coalesce(ii."description", '')) NOT LIKE 'commission:%'
          AND lower(coalesce(ii."description", '')) NOT LIKE 'credit:%'
        ORDER BY ii."id"
      `);
      const offRows = Array.isArray(offSchedItems)
        ? offSchedItems
        : (offSchedItems as { rows?: unknown[] }).rows ?? [];
      for (const r of offRows as {
        id: number; policy_id: number; policy_premium_id: number | null;
        amount_cents: number; description: string | null; status: string;
      }[]) {
        const mapped: ItemResult = {
          id: r.id, policyId: r.policy_id, policyPremiumId: r.policy_premium_id,
          amountCents: r.amount_cents, description: r.description, status: "paid_individually",
        };
        if (mapped.policyPremiumId && seenPremiumIds.has(mapped.policyPremiumId)) continue;
        if (mapped.policyPremiumId) seenPremiumIds.add(mapped.policyPremiumId);
        existingPremiumPolicyIds.add(mapped.policyId);
        allItems.push(mapped);
      }
    }

    if (allItems.length === 0) {
      return NextResponse.json({ statement: null });
    }

    // Include policy IDs from both allItems AND any existing statement items
    // so loadCommissionTotalCents can find commission payables even if they
    // weren't linked to the schedule (backfill for pre-existing data).
    const stmtPolicyIds = stmtItems.map((it) => it.policyId);
    const itemPolicyIds = [...new Set([...allItems.map((it) => it.policyId), ...stmtPolicyIds])];
    let invoicesCreated = false;

    if (itemPolicyIds.length > 0) {
      const existingInvRows = await db.execute(sql`
        SELECT DISTINCT ii.policy_id
        FROM accounting_invoice_items ii
        INNER JOIN accounting_invoices ai ON ai.id = ii.invoice_id
        WHERE ii.policy_id IN (${sql.join(itemPolicyIds.map((id) => sql`${id}`), sql`,`)})
          AND ai.invoice_type = 'individual'
          AND ai.direction = 'receivable'
          AND ai.status <> 'cancelled'
      `);
      const existInvRows = Array.isArray(existingInvRows)
        ? existingInvRows
        : (existingInvRows as { rows?: unknown[] }).rows ?? [];
      const policiesWithInvoice = new Set(
        (existInvRows as { policy_id: number }[]).map((r) => Number(r.policy_id)),
      );
      const policiesWithoutInvoice = itemPolicyIds.filter((id) => !policiesWithInvoice.has(id));
      if (policiesWithoutInvoice.length > 0) {
        const { autoCreateAccountingInvoices } = await import("@/lib/auto-create-invoices");
        const { generateDocumentNumber } = await import("@/lib/document-number");
        const { resolveDocPrefix } = await import("@/lib/resolve-prefix");
        for (const pid of policiesWithoutInvoice) {
          try {
            const docNum = await generateDocumentNumber(await resolveDocPrefix("debit_note", "DN"));
            await autoCreateAccountingInvoices(pid, "endorsement_lazy", 0, docNum);
            invoicesCreated = true;
          } catch { /* non-fatal */ }
        }
      }

      const polRows = await db
        .select({ id: policies.id, policyNumber: policies.policyNumber })
        .from(policies)
        .where(inArray(policies.id, itemPolicyIds));
      const polNumMap = new Map(polRows.map((p) => [p.id, p.policyNumber]));

      const premIdSet = [...new Set(allItems.map((it) => it.policyPremiumId).filter(Boolean))] as number[];
      const premSuffixMap = new Map<number, string>();
      if (premIdSet.length > 0) {
        const premLines = await db
          .select({ id: policyPremiums.id, policyId: policyPremiums.policyId, lineKey: policyPremiums.lineKey })
          .from(policyPremiums)
          .where(inArray(policyPremiums.id, premIdSet))
          .orderBy(policyPremiums.createdAt);
        const linesByPolicy = new Map<number, { id: number; lineKey: string }[]>();
        for (const pl of premLines) {
          const arr = linesByPolicy.get(pl.policyId) ?? [];
          arr.push({ id: pl.id, lineKey: pl.lineKey });
          linesByPolicy.set(pl.policyId, arr);
        }
        for (const [, lines] of linesByPolicy) {
          if (lines.length < 2) continue;
          lines.forEach((l, idx) => {
            premSuffixMap.set(l.id, `(${String.fromCharCode(97 + idx)})`);
          });
        }
      }

      for (const it of allItems) {
        const polNum = polNumMap.get(it.policyId) ?? "";
        const suffix = it.policyPremiumId ? (premSuffixMap.get(it.policyPremiumId) ?? "") : "";
        const fullPolNum = `${polNum}${suffix}`;
        const desc = it.description ?? "";
        const isGeneric = !desc || desc === "main" || desc.toLowerCase() === "premium";
        if (fullPolNum && isGeneric) {
          it.description = fullPolNum;
        } else if (polNum && !desc.includes(polNum)) {
          it.description = `${fullPolNum} · ${desc}`;
        }
      }
    }

    const premiumRoleTotals = new Map<number, { clientCents: number; agentCents: number }>();
    const premiumIds = [...new Set(allItems.map((it) => it.policyPremiumId).filter(Boolean))] as number[];
    if (premiumIds.length > 0) {
      const premRows = await db.select().from(policyPremiums).where(inArray(policyPremiums.id, premiumIds));
      const acctFields = await loadAccountingFields();
      for (const row of premRows) {
        premiumRoleTotals.set(row.id, {
          clientCents: resolvePremiumByRole(row as Record<string, unknown>, "client", acctFields),
          agentCents: resolvePremiumByRole(row as Record<string, unknown>, "agent", acctFields),
        });
      }
    }

    const clientPaidPolicyIds = await loadClientPaidPolicyIds(itemPolicyIds);
    const agentPaidPolicyIds = await loadAgentPaidPolicyIds(itemPolicyIds);
    const ctaPaidPolicyIds = await loadClientToAgentPaidPolicyIds(itemPolicyIds);
    const paidPolicyIds = new Set([...clientPaidPolicyIds, ...agentPaidPolicyIds]);

    const enrichedItems = allItems.map((it) => {
      const isComm = isCommissionOrCreditItem(it);
      let badge: string | undefined;
      let effectiveStatus = it.status;
      if (!isComm) {
        if (paidPolicyIds.has(it.policyId)) {
          effectiveStatus = "paid_individually";
        } else {
          effectiveStatus = "active";
        }
        if (clientPaidPolicyIds.has(it.policyId)) badge = "Client paid directly";
        else if (agentPaidPolicyIds.has(it.policyId)) badge = "Agent paid";
        if (ctaPaidPolicyIds.has(it.policyId)) {
          badge = badge ? `${badge} · Client paid agent` : "Client paid agent";
        }
      }
      const rpTotals = it.policyPremiumId ? premiumRoleTotals.get(it.policyPremiumId) : undefined;
      return {
        ...it,
        status: effectiveStatus,
        displayAmountCents: resolveDisplayedItemAmountCents(it, effectiveEntityType, premiumRoleTotals),
        clientPremiumCents: isComm ? undefined : (rpTotals?.clientCents ?? undefined),
        paymentBadge: badge,
      };
    });

    const activeTotal = enrichedItems
      .filter((it) => {
        if (it.status !== "active") return false;
        if (isCommissionOrCreditItem(it)) return false;
        return true;
      })
      .reduce((s, it) => s + resolveDisplayedItemAmountCents(it, effectiveEntityType, premiumRoleTotals), 0);

    const paidIndividuallyTotal = enrichedItems
      .filter((it) => it.status === "paid_individually" && !isCommissionOrCreditItem(it))
      .reduce((s, it) => s + resolveDisplayedItemAmountCents(it, effectiveEntityType, premiumRoleTotals), 0);

    const commissionTotalCents = await loadCommissionTotalCents(itemPolicyIds, [sid], effectiveEntityType);
    const agentPaidTotalCents = await loadAgentPaidTotalCents(itemPolicyIds, effectiveEntityType);
    const clientPaidTotalCents = computeClientPaidTotal(
      allItems, effectiveEntityType, premiumRoleTotals, clientPaidPolicyIds,
    );
    const policyClients = await loadPolicyClientMap(itemPolicyIds);

    // Load actual client_to_agent payment records per policy
    const ctaPaymentsByPolicy: Record<number, { id: number; invoiceId: number; amountCents: number; currency: string; paymentDate: string | null; paymentMethod: string | null; status: string; payer: string | null; notes: string | null; createdAt: string }[]> = {};
    if (ctaPaidPolicyIds.size > 0) {
      const ctaRows = await db.execute(sql`
        SELECT DISTINCT ON (ap.id) ap.id, ap.invoice_id, ap.amount_cents, ap.currency,
               ap.payment_date, ap.payment_method, ap.status, ap.payer, ap.notes,
               ap.created_at, ii.policy_id
        FROM accounting_payments ap
        INNER JOIN accounting_invoices ai ON ai.id = ap.invoice_id
        INNER JOIN accounting_invoice_items ii ON ii.invoice_id = ai.id
        WHERE ai.direction = 'receivable'
          AND ai.entity_type = 'client'
          AND ai.status <> 'cancelled'
          AND ap.payer = 'client_to_agent'
          AND ap.status IN ('verified', 'confirmed', 'recorded')
          AND ii.policy_id IN (${sql.join([...ctaPaidPolicyIds].map((id) => sql`${id}`), sql`,`)})
        ORDER BY ap.id, ap.created_at DESC
      `);
      const rawRows = Array.isArray(ctaRows) ? ctaRows : (ctaRows as { rows?: unknown[] }).rows ?? [];
      for (const r of rawRows as { id: number; invoice_id: number; amount_cents: number; currency: string; payment_date: string | null; payment_method: string | null; status: string; payer: string | null; notes: string | null; created_at: string; policy_id: number }[]) {
        const pid = Number(r.policy_id);
        if (!ctaPaymentsByPolicy[pid]) ctaPaymentsByPolicy[pid] = [];
        ctaPaymentsByPolicy[pid].push({
          id: r.id,
          invoiceId: r.invoice_id,
          amountCents: r.amount_cents,
          currency: r.currency,
          paymentDate: r.payment_date,
          paymentMethod: r.payment_method,
          status: r.status,
          payer: r.payer,
          notes: r.notes,
          createdAt: r.created_at,
        });
      }
    }

    const statementNumber = stmtInvoice?.invoiceNumber ?? "";
    const statementStatus = stmtInvoice?.status ?? "draft";
    const currency = stmtInvoice?.currency ?? enrichedItems[0]?.status ? "HKD" : "HKD";

    const totalDue = activeTotal + paidIndividuallyTotal;

    return NextResponse.json({
      statement: {
        statementNumber,
        statementStatus,
        totalDue,
        activeTotal,
        paidIndividuallyTotal,
        commissionTotal: commissionTotalCents,
        agentPaidTotal: agentPaidTotalCents,
        clientPaidTotal: clientPaidTotalCents,
        currency: stmtInvoice?.currency ?? "HKD",
        items: enrichedItems,
        policyClients,
        clientPaidPolicyIds: [...clientPaidPolicyIds],
        ctaPaymentsByPolicy,
      },
      invoicesCreated,
    });
  } catch (err) {
    console.error("GET statements by-schedule error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

async function loadClientPaidPolicyIds(policyIds: number[]): Promise<Set<number>> {
  const uniquePolicyIds = [...new Set(policyIds.filter((id) => Number.isFinite(id) && id > 0))];
  if (uniquePolicyIds.length === 0) return new Set();
  const result = await db.execute(sql`
    select distinct ii.policy_id
    from accounting_payments ap
    inner join accounting_invoices ai on ai.id = ap.invoice_id
    inner join accounting_invoice_items ii on ii.invoice_id = ai.id
    where ai.direction = 'receivable'
      and ai.invoice_type = 'individual'
      and ai.status <> 'cancelled'
      and ap.status in ('verified', 'confirmed', 'recorded')
      and coalesce(ap.payer, 'client') = 'client'
      and ii.policy_id in (${sql.join(uniquePolicyIds.map((id) => sql`${id}`), sql`,`)})
  `);
  const rows = Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows ?? [];
  return new Set(
    (rows as { policy_id: number }[])
      .map((r) => Number(r.policy_id))
      .filter((id) => Number.isFinite(id) && id > 0),
  );
}

function computePaidIndividuallyTotal(
  items: ItemResult[],
  entityType: string,
  premiumRoleTotals: Map<number, { clientCents: number; agentCents: number }>,
  clientPaidPolicyIds: Set<number>,
): number {
  const paidByItemStatus = items
    .filter((it) => it.status === "paid_individually")
    .reduce((s, it) => s + resolveDisplayedItemAmountCents(it, entityType, premiumRoleTotals), 0);

  if (entityType !== "agent" || clientPaidPolicyIds.size === 0) return paidByItemStatus;

  const paidByPolicyMatch = items
    .filter((it) => clientPaidPolicyIds.has(it.policyId) && !isCommissionOrCreditItem(it))
    .reduce((s, it) => s + resolveDisplayedItemAmountCents(it, entityType, premiumRoleTotals), 0);

  return Math.max(paidByItemStatus, paidByPolicyMatch);
}

function computeClientPaidTotal(
  items: ItemResult[],
  entityType: string,
  premiumRoleTotals: Map<number, { clientCents: number; agentCents: number }>,
  clientPaidPolicyIds: Set<number>,
): number {
  if (clientPaidPolicyIds.size === 0) return 0;
  return items
    .filter((it) => clientPaidPolicyIds.has(it.policyId) && !isCommissionOrCreditItem(it))
    .reduce((s, it) => s + resolveDisplayedItemAmountCents(it, entityType, premiumRoleTotals), 0);
}

async function loadCommissionTotalCents(
  policyIds: number[],
  _scheduleIds: number[],
  entityType: string,
) {
  if (entityType !== "agent") return 0;
  const uniquePolicyIds = [...new Set(policyIds.filter((id) => Number.isFinite(id) && id > 0))];
  if (uniquePolicyIds.length === 0) return 0;

  // No scheduleId filter — policyIds already scope to the correct agent's policies,
  // and commission payables may not always have scheduleId set (e.g. created before
  // the schedule existed, or for endorsement policies).
  // Only count from individual invoices to avoid double-counting when commission
  // items are also copied to the statement invoice.
  const result = await db.execute(sql`
    select coalesce(sum(ii.amount_cents), 0) as total
    from accounting_invoice_items ii
    inner join accounting_invoices ai on ai.id = ii.invoice_id
    where ii.policy_id in (${sql.join(uniquePolicyIds.map((id) => sql`${id}`), sql`,`)})
      and ai.direction = 'payable'
      and ai.entity_type = 'agent'
      and ai.invoice_type = 'individual'
      and ai.status <> 'cancelled'
      and (
        lower(coalesce(ii.description, '')) like '%commission:%'
        or lower(coalesce(ai.notes, '')) like 'agent commission%'
      )
  `);
  const rows = Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows ?? [];
  const total = Number((rows[0] as { total?: unknown } | undefined)?.total ?? 0);
  return Number.isFinite(total) ? total : 0;
}

async function loadAgentPaidPolicyIds(policyIds: number[]): Promise<Set<number>> {
  const uniquePolicyIds = [...new Set(policyIds.filter((id) => Number.isFinite(id) && id > 0))];
  if (uniquePolicyIds.length === 0) return new Set();
  const result = await db.execute(sql`
    SELECT DISTINCT ii.policy_id
    FROM accounting_payments ap
    INNER JOIN accounting_invoices ai ON ai.id = ap.invoice_id
    INNER JOIN accounting_invoice_items ii ON ii.invoice_id = ai.id
    WHERE ai.direction = 'receivable'
      AND ai.invoice_type = 'individual'
      AND ai.entity_type = 'agent'
      AND ai.status <> 'cancelled'
      AND ap.status IN ('verified', 'confirmed', 'recorded')
      AND ap.payer = 'agent'
      AND ii.policy_id IN (${sql.join(uniquePolicyIds.map((id) => sql`${id}`), sql`,`)})
  `);
  const rows = Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows ?? [];
  return new Set(
    (rows as { policy_id: number }[])
      .map((r) => Number(r.policy_id))
      .filter((id) => Number.isFinite(id) && id > 0),
  );
}

async function loadClientToAgentPaidPolicyIds(policyIds: number[]): Promise<Set<number>> {
  const uniquePolicyIds = [...new Set(policyIds.filter((id) => Number.isFinite(id) && id > 0))];
  if (uniquePolicyIds.length === 0) return new Set();
  const result = await db.execute(sql`
    SELECT DISTINCT ii.policy_id
    FROM accounting_payments ap
    INNER JOIN accounting_invoices ai ON ai.id = ap.invoice_id
    INNER JOIN accounting_invoice_items ii ON ii.invoice_id = ai.id
    WHERE ai.direction = 'receivable'
      AND ai.entity_type = 'client'
      AND ai.status <> 'cancelled'
      AND ap.status IN ('verified', 'confirmed', 'recorded')
      AND ap.payer = 'client_to_agent'
      AND ii.policy_id IN (${sql.join(uniquePolicyIds.map((id) => sql`${id}`), sql`,`)})
  `);
  const rows = Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows ?? [];
  return new Set(
    (rows as { policy_id: number }[])
      .map((r) => Number(r.policy_id))
      .filter((id) => Number.isFinite(id) && id > 0),
  );
}

async function loadAgentPaidTotalCents(policyIds: number[], entityType: string): Promise<number> {
  if (entityType !== "agent") return 0;
  const uniquePolicyIds = [...new Set(policyIds.filter((id) => Number.isFinite(id) && id > 0))];
  if (uniquePolicyIds.length === 0) return 0;
  const result = await db.execute(sql`
    SELECT coalesce(sum(ap.amount_cents), 0)::int AS total
    FROM accounting_payments ap
    WHERE ap.invoice_id IN (
      SELECT DISTINCT ai.id
      FROM accounting_invoices ai
      INNER JOIN accounting_invoice_items ii ON ii.invoice_id = ai.id
      WHERE ii.policy_id IN (${sql.join(uniquePolicyIds.map((id) => sql`${id}`), sql`,`)})
        AND ai.direction = 'receivable'
        AND ai.entity_type = 'agent'
        AND ai.invoice_type <> 'statement'
    )
    AND ap.payer = 'agent'
    AND ap.status IN ('recorded', 'verified', 'confirmed')
  `);
  const rows = Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows ?? [];
  const total = Number((rows[0] as { total?: unknown } | undefined)?.total ?? 0);
  return Number.isFinite(total) ? total : 0;
}

async function loadPolicyClientMap(policyIds: number[]): Promise<Record<number, { policyNumber: string; clientName: string }>> {
  const ids = [...new Set(policyIds.filter((id) => Number.isFinite(id) && id > 0))];
  if (ids.length === 0) return {};

  const rows = await db
    .select({
      id: policies.id,
      policyNumber: policies.policyNumber,
      clientId: policies.clientId,
      extra: cars.extraAttributes,
    })
    .from(policies)
    .leftJoin(cars, eq(cars.policyId, policies.id))
    .where(inArray(policies.id, ids));

  const clientIds = [...new Set(
    rows.map((r) => r.clientId).filter((id): id is number => id != null && id > 0),
  )];
  const clientNameMap = new Map<number, string>();
  if (clientIds.length > 0) {
    const clientRows = await db
      .select({ id: clients.id, displayName: clients.displayName })
      .from(clients)
      .where(inArray(clients.id, clientIds));
    for (const c of clientRows) {
      if (c.displayName) clientNameMap.set(c.id, c.displayName);
    }
  }

  const result: Record<number, { policyNumber: string; clientName: string }> = {};
  for (const row of rows) {
    let clientName = row.clientId ? (clientNameMap.get(row.clientId) ?? "") : "";
    if (!clientName) {
      const extra = (row.extra ?? {}) as Record<string, unknown>;
      const insured = (extra.insuredSnapshot ?? {}) as Record<string, unknown>;
      const { getInsuredDisplayName } = await import("@/lib/field-resolver");
      clientName = getInsuredDisplayName(insured) || "";
    }
    result[row.id] = { policyNumber: row.policyNumber, clientName };
  }
  return result;
}
