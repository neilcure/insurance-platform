import { NextResponse } from "next/server";
import { db } from "@/db/client";
import {
  accountingInvoices,
  accountingInvoiceItems,
  accountingPayments,
  accountingPaymentSchedules,
} from "@/db/schema/accounting";
import { policyPremiums } from "@/db/schema/premiums";
import { policies } from "@/db/schema/insurance";
import { cars } from "@/db/schema/insurance";
import { clients } from "@/db/schema/core";
import { eq, and, or, sql, inArray } from "drizzle-orm";
import { requireUser } from "@/lib/auth/require-user";
import { loadAccountingFields } from "@/lib/accounting-fields";
import { resolvePremiumByRole } from "@/lib/resolve-policy-agent";
import { generateDocumentNumber } from "@/lib/document-number";
import { resolveDocPrefix } from "@/lib/resolve-prefix";
import { markAgentPolicyItemsPaidIndividually } from "@/lib/statement-management";
import { canAccessPolicy } from "@/lib/policy-access";

export const dynamic = "force-dynamic";

let statusColReady = false;
async function ensureStatusCol() {
  if (statusColReady) return;
  await db.execute(sql`
    ALTER TABLE "accounting_invoice_items"
    ADD COLUMN IF NOT EXISTS "status" varchar(20) NOT NULL DEFAULT 'active'
  `);
  statusColReady = true;
}

async function findRelatedPolicyIds(mainPolicyId: number): Promise<number[]> {
  const ids = [mainPolicyId];

  const endorsements = await db.execute(sql`
    SELECT "policy_id" FROM "cars"
    WHERE ((extra_attributes)::jsonb ->> 'linkedPolicyId')::int = ${mainPolicyId}
  `);
  const eRows = Array.isArray(endorsements)
    ? endorsements
    : (endorsements as { rows?: unknown[] }).rows ?? [];
  for (const r of eRows as { policy_id: number }[]) {
    if (r.policy_id && !ids.includes(r.policy_id)) ids.push(r.policy_id);
  }

  const [carRow] = await db
    .select({ extra: cars.extraAttributes })
    .from(cars)
    .where(eq(cars.policyId, mainPolicyId))
    .limit(1);

  if (carRow) {
    const extra = (carRow.extra ?? {}) as Record<string, unknown>;
    const parentId = extra.linkedPolicyId ? Number(extra.linkedPolicyId) : null;
    if (parentId && !ids.includes(parentId)) {
      ids.push(parentId);
      const siblings = await db.execute(sql`
        SELECT "policy_id" FROM "cars"
        WHERE ((extra_attributes)::jsonb ->> 'linkedPolicyId')::int = ${parentId}
          AND "policy_id" != ${mainPolicyId}
      `);
      const sRows = Array.isArray(siblings)
        ? siblings
        : (siblings as { rows?: unknown[] }).rows ?? [];
      for (const r of sRows as { policy_id: number }[]) {
        if (r.policy_id && !ids.includes(r.policy_id)) ids.push(r.policy_id);
      }
    }
  }

  return ids;
}

async function syncPaidIndividuallyFromVerifiedClientPayments(policyIds: number[], audience: string | null) {
  if (audience !== "agent") return;
  const uniquePolicyIds = [...new Set(policyIds.filter((id) => Number.isFinite(id) && id > 0))];
  if (uniquePolicyIds.length === 0) return;

  const rows = await db.execute(sql`
    select distinct ai.entity_policy_id as policy_id
    from accounting_invoices ai
    inner join accounting_payments ap on ap.invoice_id = ai.id
    where ai.invoice_type = 'individual'
      and ai.direction = 'receivable'
      and ai.status = 'paid'
      and ai.entity_policy_id in (${sql.join(uniquePolicyIds.map((id) => sql`${id}`), sql`,`)})
      and ap.status in ('verified', 'confirmed', 'recorded')
      and coalesce(ap.payer, 'client') = 'client'
  `);
  const list = Array.isArray(rows) ? rows : (rows as { rows?: unknown[] }).rows ?? [];
  const paidPolicyIds = (list as { policy_id: number | null }[])
    .map((r) => Number(r.policy_id))
    .filter((id) => Number.isFinite(id) && id > 0);

  for (const paidPolicyId of paidPolicyIds) {
    await markAgentPolicyItemsPaidIndividually(paidPolicyId);
  }
}

const PREMIUM_ROLE_MAP: Record<string, "client" | "agent" | "net"> = {
  client_premium: "client",
  agent_premium: "agent",
  net_premium: "net",
};

type ItemResult = {
  id: number;
  policyId: number;
  policyPremiumId: number | null;
  amountCents: number;
  description: string | null;
  status: string;
};

type ResolvedParties = {
  organisationId: number | null;
  clientId: number | null;
  agentId: number | null;
  clientPolicyRecordId: number | null;
};

function readSnapshotClientId(extra: Record<string, unknown> | null | undefined): number | null {
  if (!extra) return null;
  const direct = Number(extra.clientId);
  if (Number.isFinite(direct) && direct > 0) return direct;

  const pkgs = (extra.packagesSnapshot ?? {}) as Record<string, unknown>;
  for (const entry of Object.values(pkgs)) {
    if (!entry || typeof entry !== "object") continue;
    const vals = ("values" in (entry as Record<string, unknown>)
      ? (entry as { values?: Record<string, unknown> }).values
      : entry) as Record<string, unknown> | undefined;
    if (!vals) continue;
    const raw = vals.clientId ?? vals.client_id ?? vals.clientID ?? vals.ClientID;
    const id = Number(raw);
    if (Number.isFinite(id) && id > 0) return id;
  }

  return null;
}

function readSnapshotClientNumber(extra: Record<string, unknown> | null | undefined): string | null {
  if (!extra) return null;
  const pkgs = (extra.packagesSnapshot ?? {}) as Record<string, unknown>;
  for (const entry of Object.values(pkgs)) {
    if (!entry || typeof entry !== "object") continue;
    const vals = ("values" in (entry as Record<string, unknown>)
      ? (entry as { values?: Record<string, unknown> }).values
      : entry) as Record<string, unknown> | undefined;
    if (!vals) continue;
    const raw = vals.clientNumber ?? vals.client_no ?? vals.clientNo ?? vals.ClientNumber ?? vals.ClientNo;
    if (typeof raw === "string" && raw.trim()) return raw.trim();
  }
  return null;
}

async function resolvePolicyParties(policyId: number): Promise<ResolvedParties> {
  const [base] = await db
    .select({
      organisationId: policies.organisationId,
      clientId: policies.clientId,
      agentId: policies.agentId,
      extra: cars.extraAttributes,
    })
    .from(policies)
    .leftJoin(cars, eq(cars.policyId, policies.id))
    .where(eq(policies.id, policyId))
    .limit(1);

  if (!base) return { organisationId: null, clientId: null, agentId: null, clientPolicyRecordId: null };

  let clientId = base.clientId ?? null;
  let agentId = base.agentId ?? null;
  const extra = (base.extra ?? {}) as Record<string, unknown>;
  let clientPolicyRecordId = Number((extra.insuredSnapshot as Record<string, unknown> | undefined)?.clientPolicyId ?? extra.clientPolicyId ?? 0);
  if (!(Number.isFinite(clientPolicyRecordId) && clientPolicyRecordId > 0)) clientPolicyRecordId = 0;

  if (!clientId) clientId = readSnapshotClientId(extra);

  const parentId = Number(extra.linkedPolicyId ?? 0);
  if ((!clientId || !agentId) && Number.isFinite(parentId) && parentId > 0) {
    const [parent] = await db
      .select({
        clientId: policies.clientId,
        agentId: policies.agentId,
        extra: cars.extraAttributes,
      })
      .from(policies)
      .leftJoin(cars, eq(cars.policyId, policies.id))
      .where(eq(policies.id, parentId))
      .limit(1);

    if (parent) {
      if (!clientId) {
        clientId = parent.clientId ?? readSnapshotClientId((parent.extra ?? {}) as Record<string, unknown>);
      }
      if (!agentId) agentId = parent.agentId ?? null;
    }
  }

  const resolveClientFromPolicyRecord = async (recordId: number) => {
    const [policyRow] = await db
      .select({
        clientId: policies.clientId,
        extra: cars.extraAttributes,
      })
      .from(policies)
      .leftJoin(cars, eq(cars.policyId, policies.id))
      .where(eq(policies.id, recordId))
      .limit(1);
    if (!policyRow) return null;
    if (policyRow.clientId) return policyRow.clientId;

    const pExtra = (policyRow.extra ?? {}) as Record<string, unknown>;
    const fromSnapshot = readSnapshotClientId(pExtra);
    if (fromSnapshot) return fromSnapshot;

    const clientNumber = readSnapshotClientNumber(pExtra);
    if (clientNumber) {
      const [client] = await db
        .select({ id: clients.id })
        .from(clients)
        .where(eq(clients.clientNumber, clientNumber))
        .limit(1);
      if (client) return client.id;
    }

    const insured = (pExtra.insuredSnapshot ?? {}) as Record<string, unknown>;
    const categoryRaw = String(insured.insured__category ?? insured.insured_category ?? "").toLowerCase();
    const category = categoryRaw === "company" ? "company" : categoryRaw === "personal" ? "personal" : null;
    const primaryId = String(
      insured.insured__idNumber
      ?? insured.insured__idnumber
      ?? insured.insured_idnumber
      ?? insured.insured_idNumber
      ?? insured.insured__brNumber
      ?? insured.insured_brNumber
      ?? "",
    ).trim();
    if (category && primaryId) {
      const [client] = await db
        .select({ id: clients.id })
        .from(clients)
        .where(and(eq(clients.category, category), eq(clients.primaryId, primaryId)))
        .limit(1);
      if (client) return client.id;
    }

    return null;
  };

  if (!clientId && clientPolicyRecordId > 0) {
    clientId = await resolveClientFromPolicyRecord(clientPolicyRecordId);
  }

  if (!clientId) {
    const clientPolicyNumber = String((extra.insuredSnapshot as Record<string, unknown> | undefined)?.clientPolicyNumber ?? "").trim();
    if (clientPolicyNumber) {
      const [clientPolicy] = await db
        .select({ id: policies.id })
        .from(policies)
        .where(eq(policies.policyNumber, clientPolicyNumber))
        .limit(1);
      if (clientPolicy) {
        clientPolicyRecordId = clientPolicy.id;
        clientId = await resolveClientFromPolicyRecord(clientPolicy.id);
      }
    }
  }

  if (!clientId) {
    const clientNumber = readSnapshotClientNumber(extra);
    if (clientNumber) {
      const [client] = await db
        .select({ id: clients.id })
        .from(clients)
        .where(eq(clients.clientNumber, clientNumber))
        .limit(1);
      if (client) clientId = client.id;
    }
  }

  if (!clientId) {
    const insured = (extra.insuredSnapshot ?? {}) as Record<string, unknown>;
    const categoryRaw = String(insured.insured__category ?? insured.insured_category ?? "").toLowerCase();
    const category = categoryRaw === "company" ? "company" : categoryRaw === "personal" ? "personal" : null;
    const primaryId = String(
      insured.insured__idNumber
      ?? insured.insured__idnumber
      ?? insured.insured_idnumber
      ?? insured.insured_idNumber
      ?? insured.insured__brNumber
      ?? insured.insured_brNumber
      ?? "",
    ).trim();
    if (category && primaryId) {
      const [client] = await db
        .select({ id: clients.id })
        .from(clients)
        .where(and(eq(clients.category, category), eq(clients.primaryId, primaryId)))
        .limit(1);
      if (client) clientId = client.id;
    }
  }

  return {
    organisationId: base.organisationId ?? null,
    clientId,
    agentId,
    clientPolicyRecordId: clientPolicyRecordId > 0 ? clientPolicyRecordId : null,
  };
}

function resolveDisplayedItemAmountCents(
  item: ItemResult,
  entityType: string,
  premiumRoleTotals: Map<number, { clientCents: number; agentCents: number }>,
  direction?: string | null,
) {
  if (!item.policyPremiumId) return item.amountCents;
  const totals = premiumRoleTotals.get(item.policyPremiumId);
  if (entityType === "agent") return totals?.agentCents ?? item.amountCents;
  if (entityType === "client") return totals?.clientCents ?? item.amountCents;
  return item.amountCents;
}

type PolicyStatementMeta = {
  isEndorsement: boolean;
};

async function loadPolicyStatementMeta(policyIds: number[]) {
  const ids = [...new Set(policyIds.filter((id) => Number.isFinite(id) && id > 0))];
  const map = new Map<number, PolicyStatementMeta>();
  if (ids.length === 0) return map;

  const rows = await db
    .select({
      id: policies.id,
      flowKey: policies.flowKey,
      extra: cars.extraAttributes,
    })
    .from(policies)
    .leftJoin(cars, eq(cars.policyId, policies.id))
    .where(inArray(policies.id, ids));

  for (const row of rows) {
    const extra = (row.extra ?? {}) as Record<string, unknown>;
    const linkedPolicyId = Number(extra.linkedPolicyId ?? 0);
    const flowKey = String(row.flowKey ?? extra.flowKey ?? "").trim().toLowerCase();
    map.set(row.id, {
      isEndorsement: linkedPolicyId > 0 || flowKey.includes("endorse"),
    });
  }

  return map;
}

function isCreditStatementItem(item: ItemResult) {
  const desc = String(item.description ?? "").trim().toLowerCase();
  if (item.policyPremiumId) return false;
  return desc.startsWith("credit:");
}

function isCommissionStatementItem(item: ItemResult) {
  const desc = String(item.description ?? "").trim().toLowerCase();
  if (item.policyPremiumId) return false;
  return desc.startsWith("commission:");
}

function applyStatementItemPremiumAliases(
  target: Record<string, number>,
  field: { key: string; label: string; premiumRole?: string },
  value: number,
) {
  const setAlias = (alias: string, nextValue: number) => {
    const existing = target[alias];
    if (
      existing === undefined
      || existing === null
      || (Number(existing) === 0 && Number(nextValue) !== 0)
    ) {
      target[alias] = nextValue;
    }
  };

  const roleAliasMap: Record<string, string> = {
    client: "clientPremium",
    agent: "agentPremium",
    net: "netPremium",
    commission: "agentCommission",
  };
  const labelAliasMap: Record<string, string> = {
    client_premium: "clientPremium",
    agent_premium: "agentPremium",
    net_premium: "netPremium",
    gross: "grossPremium",
    credit: "creditPremium",
    levy: "levy",
    stamp: "stampDuty",
    discount: "discount",
    currency: "currency",
    commission_rate: "commissionRate",
  };

  if (field.premiumRole && roleAliasMap[field.premiumRole]) {
    setAlias(roleAliasMap[field.premiumRole], value);
  }
  const lbl = String(field.label ?? "").toLowerCase().replace(/\s+/g, "_");
  for (const [pattern, alias] of Object.entries(labelAliasMap)) {
    if (lbl.includes(pattern)) {
      setAlias(alias, value);
    }
  }
}

function buildStatementSummaryTotals(
  items: ItemResult[],
  entityType: string,
  premiumRoleTotals: Map<number, { clientCents: number; agentCents: number }>,
  policyMetaById: Map<number, PolicyStatementMeta>,
  commissionTotalCents: number,
  direction?: string | null,
) {
  const totals: Record<string, number> = {};
  let policyPremiumTotal = 0;
  let endorsementPremiumTotal = 0;
  let creditTotal = 0;
  let commissionLineTotal = 0;
  let hasPolicyPremium = false;
  let hasEndorsementPremium = false;
  let hasCredit = false;
  let hasCommission = false;

  for (const item of items) {
    const amountCents = resolveDisplayedItemAmountCents(item, entityType, premiumRoleTotals, direction);
    const rawAmountCents = item.amountCents ?? 0;
    if (Number.isFinite(amountCents) && amountCents !== 0) {
      if (isCreditStatementItem(item)) {
        creditTotal += rawAmountCents;
        hasCredit = true;
      } else if (isCommissionStatementItem(item)) {
        commissionLineTotal += rawAmountCents;
        hasCommission = true;
      } else if (policyMetaById.get(item.policyId)?.isEndorsement) {
        endorsementPremiumTotal += amountCents;
        hasEndorsementPremium = true;
      } else {
        policyPremiumTotal += amountCents;
        hasPolicyPremium = true;
      }
    }
  }

  if (hasPolicyPremium) totals.policyPremiumTotal = policyPremiumTotal;
  if (hasEndorsementPremium) totals.endorsementPremiumTotal = endorsementPremiumTotal;
  if (hasCredit) totals.creditTotal = creditTotal;
  if (commissionTotalCents > 0 || hasCommission) {
    totals.commissionTotal = Math.max(commissionTotalCents, commissionLineTotal);
  }

  return totals;
}

async function loadCommissionTotalCents(
  policyIds: number[],
  scheduleIds: number[],
  entityType: string,
) {
  if (entityType !== "agent") return 0;

  const uniquePolicyIds = [...new Set(policyIds.filter((id) => Number.isFinite(id) && id > 0))];
  if (uniquePolicyIds.length === 0) return 0;

  const scheduleFilter = scheduleIds.length > 0
    ? sql`and ai.schedule_id in (${sql.join(scheduleIds.map((id) => sql`${id}`), sql`,`)})`
    : sql``;

  const result = await db.execute(sql`
    select coalesce(sum(ii.amount_cents), 0) as total
    from accounting_invoice_items ii
    inner join accounting_invoices ai on ai.id = ii.invoice_id
    where ii.policy_id in (${sql.join(uniquePolicyIds.map((id) => sql`${id}`), sql`,`)})
      and ai.direction = 'payable'
      and ai.entity_type = 'agent'
      and ai.status <> 'cancelled'
      and (
        lower(coalesce(ii.description, '')) like 'commission:%'
        or lower(coalesce(ai.notes, '')) like 'agent commission%'
      )
      ${scheduleFilter}
  `);

  const rows = Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows ?? [];
  const total = Number((rows[0] as { total?: unknown } | undefined)?.total ?? 0);
  return Number.isFinite(total) ? total : 0;
}

async function loadClientPaidPolicyIds(
  policyIds: number[],
): Promise<Set<number>> {
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
  direction?: string | null,
): number {
  const paidByItemStatus = items
    .filter((it) => it.status === "paid_individually")
    .reduce((s, it) => s + resolveDisplayedItemAmountCents(it, entityType, premiumRoleTotals, direction), 0);

  if (entityType !== "agent" || clientPaidPolicyIds.size === 0) return paidByItemStatus;

  const paidByPolicyMatch = items
    .filter((it) => it.policyPremiumId && clientPaidPolicyIds.has(it.policyId))
    .reduce((s, it) => s + resolveDisplayedItemAmountCents(it, entityType, premiumRoleTotals, direction), 0);

  return Math.max(paidByItemStatus, paidByPolicyMatch);
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

async function buildPreviewFromScheduledInvoices(
  scheduleIds: number[],
  audience: string | null,
  policyIds: number[],
) {
  const allSchedIds = [...new Set(scheduleIds)];
  const shouldScopeToPolicy = audience === "client";
  const scopedPolicyIds = [...new Set(policyIds.filter((id) => Number.isFinite(id) && id > 0))];
  if (allSchedIds.length === 0 || (shouldScopeToPolicy && scopedPolicyIds.length === 0)) return null;

  const linkedInvs = await db
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
      premiumType: accountingInvoices.premiumType,
      direction: accountingInvoices.direction,
    })
    .from(accountingInvoices)
    .where(
      and(
        inArray(accountingInvoices.scheduleId, allSchedIds),
        eq(accountingInvoices.invoiceType, "individual"),
        inArray(accountingInvoices.status, [
          "draft",
          "pending",
          "partial",
          "settled",
          "active",
          "statement_created",
          "statement_sent",
          "statement_confirmed",
        ]),
        audience ? eq(accountingInvoices.entityType, audience) : undefined,
      ),
    );

  if (linkedInvs.length === 0) return null;

  const first = linkedInvs[0];
  const linkedInvIds = linkedInvs.map((i) => i.id);

  const linkedItemsRaw = await db.execute(sql`
    SELECT "id", "policy_id", "policy_premium_id", "amount_cents",
           "description", coalesce("status", 'active') AS "status"
    FROM "accounting_invoice_items"
    WHERE "invoice_id" IN (${sql.join(linkedInvIds.map((id) => sql`${id}`), sql`,`)})
      ${shouldScopeToPolicy
        ? sql`AND "policy_id" IN (${sql.join(scopedPolicyIds.map((id) => sql`${id}`), sql`,`)})`
        : sql``}
    ORDER BY "id"
  `);
  const linkedRows = Array.isArray(linkedItemsRaw)
    ? linkedItemsRaw
    : (linkedItemsRaw as { rows?: unknown[] }).rows ?? [];

  const synthItems: ItemResult[] = (linkedRows as {
    id: number; policy_id: number; policy_premium_id: number | null;
    amount_cents: number; description: string | null; status: string;
  }[]).map((r) => ({
    id: r.id, policyId: r.policy_id, policyPremiumId: r.policy_premium_id,
    amountCents: r.amount_cents, description: r.description, status: r.status,
  }));

  if (synthItems.length === 0) return null;

  const itemPolicyIds = [...new Set(synthItems.map((it) => it.policyId))];
  if (itemPolicyIds.length > 0) {
    const polRows = await db
      .select({ id: policies.id, policyNumber: policies.policyNumber })
      .from(policies)
      .where(inArray(policies.id, itemPolicyIds));
    const polNumMap = new Map(polRows.map((p) => [p.id, p.policyNumber]));

    const premIdSet = [...new Set(synthItems.map((it) => it.policyPremiumId).filter(Boolean))] as number[];
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

    for (const it of synthItems) {
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

  const premiumTotals: Record<string, number> = {};
  const itemPremiumMap = new Map<number, Record<string, number>>();
  const premiumRoleTotals = new Map<number, { clientCents: number; agentCents: number }>();
  const premiumIds = [...new Set(synthItems.map((it) => it.policyPremiumId).filter(Boolean))] as number[];
  if (premiumIds.length > 0) {
    const premRows = await db.select().from(policyPremiums).where(inArray(policyPremiums.id, premiumIds));
    const acctFields = await loadAccountingFields();
    const { buildFieldColumnMap, getColumnType } = await import("@/lib/accounting-fields");
    const colMap = buildFieldColumnMap(acctFields);
    for (const row of premRows) {
      const rowValues: Record<string, number> = {};
      premiumRoleTotals.set(row.id, {
        clientCents: resolvePremiumByRole(row as Record<string, unknown>, "client", acctFields),
        agentCents: resolvePremiumByRole(row as Record<string, unknown>, "agent", acctFields),
      });
      for (const f of acctFields) {
        const mappedCol = colMap[f.key];
        let val: number | null = null;
        if (mappedCol) {
          const rawVal = (row as Record<string, unknown>)[mappedCol];
          if (rawVal != null) val = getColumnType(mappedCol) === "cents" ? Number(rawVal) / 100 : Number(rawVal);
        } else {
          const extra = (row.extraValues ?? {}) as Record<string, unknown>;
          if (extra[f.key] != null) val = Number(extra[f.key]);
        }
        if (val != null && Number.isFinite(val)) {
          premiumTotals[f.key] = (premiumTotals[f.key] ?? 0) + val;
          rowValues[f.key] = val;
          applyStatementItemPremiumAliases(rowValues, f, val);
        }
      }
      itemPremiumMap.set(row.id, rowValues);
    }
  }

  const enrichedItems = synthItems.map((it) => ({
    ...it,
    premiums: it.policyPremiumId ? (itemPremiumMap.get(it.policyPremiumId) ?? {}) : {},
    displayAmountCents: resolveDisplayedItemAmountCents(it, first.entityType, premiumRoleTotals, first.direction),
  }));
  const policyMetaById = await loadPolicyStatementMeta(itemPolicyIds);
  const commissionTotalCents = await loadCommissionTotalCents(itemPolicyIds, allSchedIds, first.entityType);
  const activeTotal = synthItems
    .filter((it) => it.status === "active")
    .reduce((s, it) => s + resolveDisplayedItemAmountCents(it, first.entityType, premiumRoleTotals, first.direction), 0);
  const clientPaidPolicyIds = await loadClientPaidPolicyIds(itemPolicyIds);
  const paidIndividuallyTotal = computePaidIndividuallyTotal(
    synthItems, first.entityType, premiumRoleTotals, clientPaidPolicyIds, first.direction,
  );
  const totalCents = activeTotal + paidIndividuallyTotal;
  const paidCents = paidIndividuallyTotal;
  const summaryTotals = buildStatementSummaryTotals(
    synthItems,
    first.entityType,
    premiumRoleTotals,
    policyMetaById,
    commissionTotalCents,
    first.direction,
  );

  const policyClients = await loadPolicyClientMap(itemPolicyIds);

  return {
    first,
    totalCents,
    paidCents,
    enrichedItems,
    premiumTotals,
    summaryTotals,
    activeTotal,
    paidIndividuallyTotal,
    policyClients,
    clientPaidPolicyIds: [...clientPaidPolicyIds],
  };
}

export async function GET(
  request: Request,
  ctx: { params: Promise<{ policyId: string }> },
) {
  try {
    const user = await requireUser();
    const { policyId } = await ctx.params;
    const pid = Number(policyId);
    if (!Number.isFinite(pid) || pid <= 0) {
      return NextResponse.json({ error: "Invalid policy id" }, { status: 400 });
    }
    const hasAccess = await canAccessPolicy({ id: Number(user.id), userType: user.userType }, pid);
    if (!hasAccess) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const url = new URL(request.url);
    const audience = url.searchParams.get("audience");

    await ensureStatusCol();

    const allPolicyIds = await findRelatedPolicyIds(pid);
    try {
      await syncPaidIndividuallyFromVerifiedClientPayments(allPolicyIds, audience);
    } catch (err) {
      console.error("sync paid-individually fallback failed:", err);
    }

    const policyItemRows = await db
      .selectDistinct({ invoiceId: accountingInvoiceItems.invoiceId })
      .from(accountingInvoiceItems)
      .where(inArray(accountingInvoiceItems.policyId, allPolicyIds));

    if (policyItemRows.length === 0) {
      const pol = await resolvePolicyParties(pid);
      if (!pol.organisationId) {
        return NextResponse.json({ statement: null, hasSchedule: false });
      }

      const entityConds = [];
      if (pol.clientId && (!audience || audience === "client")) {
        entityConds.push(
          and(eq(accountingPaymentSchedules.entityType, "client"), eq(accountingPaymentSchedules.clientId, pol.clientId)),
        );
      } else if (pol.clientPolicyRecordId && (!audience || audience === "client")) {
        entityConds.push(
          and(eq(accountingPaymentSchedules.entityType, "client"), eq(accountingPaymentSchedules.entityPolicyId, pol.clientPolicyRecordId)),
        );
      }
      if (pol.agentId && (!audience || audience === "agent")) {
        entityConds.push(
          and(eq(accountingPaymentSchedules.entityType, "agent"), eq(accountingPaymentSchedules.agentId, pol.agentId)),
        );
      }

      if (entityConds.length === 0) {
        return NextResponse.json({ statement: null, hasSchedule: false });
      }

      const directSchedules = await db
        .select({ id: accountingPaymentSchedules.id })
        .from(accountingPaymentSchedules)
        .where(
          and(
            eq(accountingPaymentSchedules.organisationId, pol.organisationId),
            eq(accountingPaymentSchedules.isActive, true),
            entityConds.length === 1 ? entityConds[0] : or(...entityConds),
          ),
        );

      return NextResponse.json({ statement: null, hasSchedule: directSchedules.length > 0 });
    }

    const invoiceIds = policyItemRows.map((r) => r.invoiceId);

    const invoiceRows = await db
      .select({
        id: accountingInvoices.id,
        scheduleId: accountingInvoices.scheduleId,
        invoiceType: accountingInvoices.invoiceType,
        entityType: accountingInvoices.entityType,
      direction: accountingInvoices.direction,
      })
      .from(accountingInvoices)
      .where(inArray(accountingInvoices.id, invoiceIds));

    const relevantInvoiceRows = invoiceRows.filter((r) => !audience || r.entityType === audience);
    const scheduleIds = [
      ...new Set(
        relevantInvoiceRows
          .filter((r) => r.scheduleId != null)
          .map((r) => r.scheduleId as number),
      ),
    ];

    let stmt: {
      id: number;
      invoiceNumber: string;
      status: string;
      totalAmountCents: number;
      paidAmountCents: number;
      currency: string;
      entityType: string;
      entityName: string | null;
      invoiceDate: string | null;
      premiumType: string;
      direction: string;
    } | null = null;

    if (scheduleIds.length > 0) {
      const conditions = [
        inArray(accountingInvoices.scheduleId, scheduleIds),
        eq(accountingInvoices.invoiceType, "statement"),
        inArray(accountingInvoices.status, [
          "draft", "pending", "partial", "settled", "active",
          "statement_created", "statement_sent", "statement_confirmed",
        ]),
      ];

      if (audience === "agent") {
        conditions.push(eq(accountingInvoices.entityType, "agent"));
      } else if (audience === "client") {
        conditions.push(eq(accountingInvoices.entityType, "client"));
      }

      const [found] = await db
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
          premiumType: accountingInvoices.premiumType,
          direction: accountingInvoices.direction,
        })
        .from(accountingInvoices)
        .where(and(...conditions))
        .limit(1);

      if (found) stmt = found;
    }

    if (!stmt) {
      const directStmt = invoiceRows.find(
        (r) =>
          r.invoiceType === "statement" &&
          (!audience || r.entityType === audience),
      );
      if (directStmt) {
        const [found] = await db
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
            premiumType: accountingInvoices.premiumType,
            direction: accountingInvoices.direction,
          })
          .from(accountingInvoices)
          .where(eq(accountingInvoices.id, directStmt.id))
          .limit(1);
        if (found) stmt = found;
      }
    }

    let hasSchedule = scheduleIds.length > 0;

    if (!stmt) {
      const pol = await resolvePolicyParties(pid);

      if (pol.organisationId) {
        const entityConds = [];
        if (pol.clientId && (!audience || audience === "client")) {
          entityConds.push(
            and(eq(accountingPaymentSchedules.entityType, "client"), eq(accountingPaymentSchedules.clientId, pol.clientId)),
          );
        } else if (pol.clientPolicyRecordId && (!audience || audience === "client")) {
          entityConds.push(
            and(eq(accountingPaymentSchedules.entityType, "client"), eq(accountingPaymentSchedules.entityPolicyId, pol.clientPolicyRecordId)),
          );
        }
        if (pol.agentId && (!audience || audience === "agent")) {
          entityConds.push(
            and(eq(accountingPaymentSchedules.entityType, "agent"), eq(accountingPaymentSchedules.agentId, pol.agentId)),
          );
        }
        if (entityConds.length > 0) {
          const directSchedules = await db
            .select({ id: accountingPaymentSchedules.id })
            .from(accountingPaymentSchedules)
            .where(
              and(
                eq(accountingPaymentSchedules.organisationId, pol.organisationId),
                eq(accountingPaymentSchedules.isActive, true),
                entityConds.length === 1 ? entityConds[0] : or(...entityConds),
              ),
            );

          if (directSchedules.length > 0) hasSchedule = true;

          const directSchedIds = directSchedules.map((s) => s.id).filter((id) => !scheduleIds.includes(id));
          for (const id of directSchedIds) scheduleIds.push(id);
          if (directSchedIds.length > 0) {
            const stmtConds = [
              inArray(accountingInvoices.scheduleId, directSchedIds),
              eq(accountingInvoices.invoiceType, "statement"),
              inArray(accountingInvoices.status, [
                "draft", "pending", "partial", "settled", "active",
                "statement_created", "statement_sent", "statement_confirmed",
              ]),
            ];
            if (audience === "agent") stmtConds.push(eq(accountingInvoices.entityType, "agent"));
            else if (audience === "client") stmtConds.push(eq(accountingInvoices.entityType, "client"));

            const [found] = await db
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
                premiumType: accountingInvoices.premiumType,
                direction: accountingInvoices.direction,
              })
              .from(accountingInvoices)
              .where(and(...stmtConds))
              .limit(1);
            if (found) stmt = found;
          }
        }
      }
    }

    if (!stmt && hasSchedule) {
      // No formal statement invoice yet, but invoices ARE on a schedule.
      // Build preview data from the schedule-linked invoices so the
      // statement document template can render.
      const preview = await buildPreviewFromScheduledInvoices(scheduleIds, audience, allPolicyIds);
      if (preview) {
        const { first, totalCents, paidCents, enrichedItems, activeTotal, paidIndividuallyTotal, premiumTotals, summaryTotals, policyClients, clientPaidPolicyIds: paidIds } = preview;
          return NextResponse.json({
            statement: {
              statementNumber: "",
              statementDate: new Date().toISOString().split("T")[0],
              statementStatus: "draft",
              totalAmountCents: totalCents,
              paidAmountCents: paidCents,
              currency: first.currency,
              entityType: first.entityType,
              entityName: first.entityName,
              items: enrichedItems,
              activeTotal,
              paidIndividuallyTotal,
              premiumTotals,
              summaryTotals,
              policyClients,
              clientPaidPolicyIds: paidIds,
            },
            hasSchedule: true,
          });
        }
      }

    if (!stmt) {
      return NextResponse.json({ statement: null, hasSchedule });
    }

    // Fix statement number if it uses old hardcoded "ST-" prefix instead of template prefix
    if (stmt.invoiceNumber.startsWith("ST-")) {
      try {
        const tplPrefix = await resolveDocPrefix("statement", "ST");
        if (tplPrefix !== "ST") {
          const newNumber = await generateDocumentNumber(tplPrefix);
          await db.update(accountingInvoices).set({ invoiceNumber: newNumber }).where(eq(accountingInvoices.id, stmt.id));
          stmt.invoiceNumber = newNumber;
        }
      } catch { /* non-fatal */ }
    }

    // Get ALL items on the statement
    const rawItems = await db.execute(sql`
      SELECT "id", "policy_id", "policy_premium_id", "amount_cents",
             "description", coalesce("status", 'active') AS "status"
      FROM "accounting_invoice_items"
      WHERE "invoice_id" = ${stmt.id}
      ORDER BY "id"
    `);

    const rawRows = Array.isArray(rawItems)
      ? rawItems
      : (rawItems as { rows?: unknown[] }).rows ?? [];

    const allStatementItems: ItemResult[] = (
      rawRows as {
        id: number;
        policy_id: number;
        policy_premium_id: number | null;
        amount_cents: number;
        description: string | null;
        status: string;
      }[]
    ).map((r) => ({
      id: r.id,
      policyId: r.policy_id,
      policyPremiumId: r.policy_premium_id,
      amountCents: r.amount_cents,
      description: r.description,
      status: r.status,
    }));
    const shouldScopeToPolicy = audience === "client";
    const items = shouldScopeToPolicy
      ? allStatementItems.filter((it) => allPolicyIds.includes(it.policyId))
      : allStatementItems;
    const isPolicyScopedView = shouldScopeToPolicy && items.length !== allStatementItems.length;

    // Enrich descriptions with policy numbers + line suffix (a)/(b) for multi-line
    const formalItemPolicyIds = [...new Set(items.map((it) => it.policyId))];
    if (formalItemPolicyIds.length > 0) {
      const polRows = await db
        .select({ id: policies.id, policyNumber: policies.policyNumber })
        .from(policies)
        .where(inArray(policies.id, formalItemPolicyIds));
      const polNumMap = new Map(polRows.map((p) => [p.id, p.policyNumber]));

      const fPremIds = [...new Set(items.map((it) => it.policyPremiumId).filter(Boolean))] as number[];
      const fPremSuffixMap = new Map<number, string>();
      if (fPremIds.length > 0) {
        const fPremLines = await db
          .select({ id: policyPremiums.id, policyId: policyPremiums.policyId, lineKey: policyPremiums.lineKey })
          .from(policyPremiums)
          .where(inArray(policyPremiums.id, fPremIds))
          .orderBy(policyPremiums.createdAt);
        const fLinesByPolicy = new Map<number, { id: number; lineKey: string }[]>();
        for (const pl of fPremLines) {
          const arr = fLinesByPolicy.get(pl.policyId) ?? [];
          arr.push({ id: pl.id, lineKey: pl.lineKey });
          fLinesByPolicy.set(pl.policyId, arr);
        }
        for (const [, lines] of fLinesByPolicy) {
          if (lines.length < 2) continue;
          lines.forEach((l, idx) => {
            fPremSuffixMap.set(l.id, `(${String.fromCharCode(97 + idx)})`);
          });
        }
      }

      for (const it of items) {
        const polNum = polNumMap.get(it.policyId) ?? "";
        const suffix = it.policyPremiumId ? (fPremSuffixMap.get(it.policyPremiumId) ?? "") : "";
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

    // Find endorsement items not yet on the statement
    const stmtScheduleId = await db
      .select({ scheduleId: accountingInvoices.scheduleId })
      .from(accountingInvoices)
      .where(eq(accountingInvoices.id, stmt.id))
      .limit(1)
      .then((r) => r[0]?.scheduleId ?? null);

    if (stmtScheduleId && items.length === 0) {
      const preview = await buildPreviewFromScheduledInvoices([stmtScheduleId], audience, allPolicyIds);
      if (preview) {
        return NextResponse.json({
          statement: {
            statementNumber: stmt.invoiceNumber,
            statementDate: stmt.invoiceDate,
            statementStatus: stmt.status,
            totalAmountCents: stmt.totalAmountCents > 0 ? stmt.totalAmountCents : preview.totalCents,
            paidAmountCents: stmt.paidAmountCents > 0 ? stmt.paidAmountCents : preview.paidCents,
            currency: stmt.currency,
            entityType: stmt.entityType,
            entityName: stmt.entityName,
            items: preview.enrichedItems,
            activeTotal: preview.activeTotal,
            paidIndividuallyTotal: preview.paidIndividuallyTotal,
            premiumTotals: preview.premiumTotals,
            summaryTotals: preview.summaryTotals,
            policyClients: preview.policyClients,
            clientPaidPolicyIds: preview.clientPaidPolicyIds,
          },
        });
      }
    }

    if (stmtScheduleId) {
      const existingPolicyIds = new Set(items.map((it) => it.policyId));
      let candidatePolicyIds: number[] = allPolicyIds;
      if (!shouldScopeToPolicy) {
        const schedulePolicyRowsRes = await db.execute(sql`
          SELECT DISTINCT ii."policy_id"
          FROM "accounting_invoice_items" ii
          INNER JOIN "accounting_invoices" ai ON ai."id" = ii."invoice_id"
          WHERE ai."schedule_id" = ${stmtScheduleId}
            AND ai."invoice_type" = 'individual'
            AND ai."entity_type" = ${stmt.entityType}
            AND ai."status" IN ('draft', 'pending', 'partial', 'settled', 'active', 'statement_created', 'statement_sent', 'statement_confirmed')
        `);
        const schedulePolicyRows = Array.isArray(schedulePolicyRowsRes)
          ? schedulePolicyRowsRes
          : (schedulePolicyRowsRes as { rows?: unknown[] }).rows ?? [];
        candidatePolicyIds = (schedulePolicyRows as { policy_id: number }[])
          .map((r) => Number(r.policy_id))
          .filter((id) => Number.isFinite(id) && id > 0);
      }
      const missingPolicyIds = candidatePolicyIds.filter((id) => !existingPolicyIds.has(id));

      if (missingPolicyIds.length > 0) {
        const role = stmt.direction === "payable" ? null : (PREMIUM_ROLE_MAP[stmt.premiumType] ?? null);
        const accountingFields = role ? await loadAccountingFields() : null;

        // Get policy numbers for the missing policies
        const policyNumberMap = new Map<number, string>();
        const policyRows = await db
          .select({ id: policies.id, policyNumber: policies.policyNumber })
          .from(policies)
          .where(inArray(policies.id, missingPolicyIds));
        for (const p of policyRows) policyNumberMap.set(p.id, p.policyNumber);

        // Find individual invoices on the same schedule for missing policies
        const missingInvoices = await db
          .select({ id: accountingInvoices.id })
          .from(accountingInvoices)
          .where(
            and(
              eq(accountingInvoices.scheduleId, stmtScheduleId),
              eq(accountingInvoices.invoiceType, "individual"),
              eq(accountingInvoices.entityType, stmt.entityType),
              inArray(accountingInvoices.status, [
                "draft", "pending", "partial", "settled", "active",
                "statement_created", "statement_sent", "statement_confirmed",
              ]),
            ),
          );

        if (missingInvoices.length > 0) {
          const missingInvIds = missingInvoices.map((r) => r.id);
          const missingItemsRes = await db.execute(sql`
            SELECT "id", "policy_id", "policy_premium_id", "amount_cents",
                   "description", coalesce("status", 'active') AS "status"
            FROM "accounting_invoice_items"
            WHERE "invoice_id" IN (${sql.join(missingInvIds.map((id) => sql`${id}`), sql`,`)})
              AND "policy_id" IN (${sql.join(missingPolicyIds.map((id) => sql`${id}`), sql`,`)})
            ORDER BY "id"
          `);

          const missingRows = Array.isArray(missingItemsRes)
            ? missingItemsRes
            : (missingItemsRes as { rows?: unknown[] }).rows ?? [];

          for (const r of missingRows as {
            id: number;
            policy_id: number;
            policy_premium_id: number | null;
            amount_cents: number;
            description: string | null;
            status: string;
          }[]) {
            let resolvedAmount = r.amount_cents;

            // Resolve correct premium amount based on statement's premiumType
            if (role && accountingFields && r.policy_premium_id) {
              const [premRow] = await db
                .select()
                .from(policyPremiums)
                .where(eq(policyPremiums.id, r.policy_premium_id))
                .limit(1);
              if (premRow) {
                const resolved = Math.abs(
                  resolvePremiumByRole(
                    premRow as Record<string, unknown>,
                    role,
                    accountingFields,
                  ),
                );
                if (resolved > 0) resolvedAmount = resolved;
              }
            }

            // Include policy number in description
            const polNum = policyNumberMap.get(r.policy_id) ?? "";
            const desc = polNum
              ? `${polNum} · ${r.description ?? "Premium"}`
              : r.description;

            items.push({
              id: r.id,
              policyId: r.policy_id,
              policyPremiumId: r.policy_premium_id,
              amountCents: resolvedAmount,
              description: desc,
              status: r.status,
            });
          }
        }
      }
    }

    // Build premium totals + per-item breakdowns from the actual policy_premiums rows
    const premiumTotals: Record<string, number> = {};
    const itemPremiumMap = new Map<number, Record<string, number>>();
    const premiumRoleTotals = new Map<number, { clientCents: number; agentCents: number }>();
    const premiumIds = [...new Set(items.map((it) => it.policyPremiumId).filter(Boolean))] as number[];
    if (premiumIds.length > 0) {
      try {
        const premRows = await db.select().from(policyPremiums).where(inArray(policyPremiums.id, premiumIds));
        const accountingFields = await loadAccountingFields();
        const { buildFieldColumnMap, getColumnType } = await import("@/lib/accounting-fields");
        const colMap = buildFieldColumnMap(accountingFields);
        for (const row of premRows) {
          const rowValues: Record<string, number> = {};
          premiumRoleTotals.set(row.id, {
            clientCents: resolvePremiumByRole(row as Record<string, unknown>, "client", accountingFields),
            agentCents: resolvePremiumByRole(row as Record<string, unknown>, "agent", accountingFields),
          });
          for (const f of accountingFields) {
            const mappedCol = colMap[f.key];
            let val: number | null = null;
            if (mappedCol) {
              const rawVal = (row as Record<string, unknown>)[mappedCol];
              if (rawVal != null) {
                val = getColumnType(mappedCol) === "cents" ? Number(rawVal) / 100 : Number(rawVal);
              }
            } else {
              const extra = (row.extraValues ?? {}) as Record<string, unknown>;
              if (extra[f.key] != null) val = Number(extra[f.key]);
            }
            if (val != null && Number.isFinite(val)) {
              premiumTotals[f.key] = (premiumTotals[f.key] ?? 0) + val;
              rowValues[f.key] = val;
              applyStatementItemPremiumAliases(rowValues, f, val);
            }
          }
          itemPremiumMap.set(row.id, rowValues);
        }
      } catch { /* non-fatal */ }
    }

    const enrichedItems = items.map((it) => ({
      ...it,
      premiums: it.policyPremiumId ? (itemPremiumMap.get(it.policyPremiumId) ?? {}) : {},
      displayAmountCents: resolveDisplayedItemAmountCents(it, stmt.entityType, premiumRoleTotals, stmt.direction),
    }));
    const policyMetaById = await loadPolicyStatementMeta(items.map((it) => it.policyId));
    const commissionTotalCents = await loadCommissionTotalCents(
      items.map((it) => it.policyId),
      stmtScheduleId ? [stmtScheduleId] : scheduleIds,
      stmt.entityType,
    );
    const activeTotal = items
      .filter((it) => it.status === "active")
      .reduce((sum, it) => sum + resolveDisplayedItemAmountCents(it, stmt.entityType, premiumRoleTotals, stmt.direction), 0);
    const clientPaidPolicyIds2 = await loadClientPaidPolicyIds(items.map((it) => it.policyId));
    const paidIndividuallyTotal = computePaidIndividuallyTotal(
      items, stmt.entityType, premiumRoleTotals, clientPaidPolicyIds2, stmt.direction,
    );
    const summaryTotals = buildStatementSummaryTotals(
      items,
      stmt.entityType,
      premiumRoleTotals,
      policyMetaById,
      commissionTotalCents,
      stmt.direction,
    );

    if (items.length === 0) {
      return NextResponse.json({ statement: null, hasSchedule });
    }

    const formalPolicyClients = await loadPolicyClientMap(items.map((it) => it.policyId));

    return NextResponse.json({
      statement: {
        statementNumber: stmt.invoiceNumber,
        statementDate: stmt.invoiceDate,
        statementStatus: stmt.status,
        totalAmountCents: isPolicyScopedView ? activeTotal + paidIndividuallyTotal : stmt.totalAmountCents,
        paidAmountCents: isPolicyScopedView ? paidIndividuallyTotal : stmt.paidAmountCents,
        currency: stmt.currency,
        entityType: stmt.entityType,
        entityName: stmt.entityName,
        items: enrichedItems,
        activeTotal,
        paidIndividuallyTotal,
        premiumTotals,
        summaryTotals,
        policyClients: formalPolicyClients,
        clientPaidPolicyIds: [...clientPaidPolicyIds2],
      },
    });
  } catch (err) {
    console.error("GET statements by-policy error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
