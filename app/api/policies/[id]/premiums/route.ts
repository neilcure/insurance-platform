import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { policyPremiums } from "@/db/schema/premiums";
import { policies, cars } from "@/db/schema/insurance";
import { memberships, organisations } from "@/db/schema/core";
import { formOptions } from "@/db/schema/form_options";
import { and, eq, desc } from "drizzle-orm";
import { requireUser } from "@/lib/auth/require-user";
import { getPolicyColumns } from "@/lib/db/column-check";
import { appendPolicyAudit } from "@/lib/audit";
import { sql } from "drizzle-orm";
import { loadAccountingFields, buildFieldColumnMap, getColumnType, filterFieldsByContext, type AccountingFieldDef, type PremiumContext } from "@/lib/accounting-fields";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

type FieldDef = AccountingFieldDef;

type LineTemplate = { key: string; label: string };

type CoverTypeOption = {
  value: string;
  label: string;
  accountingLines?: LineTemplate[];
};

type LineData = {
  lineKey: string;
  lineLabel: string;
  values: Record<string, unknown>;
  margin: number | null;
  updatedAt: string | null;
  insurerId: number | null;
  insurerName: string | null;
  collaboratorId: number | null;
  collaboratorName: string | null;
};

// loadAccountingFields is imported from @/lib/accounting-fields

async function loadCoverTypeOptions(): Promise<CoverTypeOption[]> {
  try {
    const rows = await db
      .select()
      .from(formOptions)
      .where(and(eq(formOptions.groupKey, "policy_category"), eq(formOptions.isActive, true)))
      .orderBy(formOptions.sortOrder);

    return rows.map((r) => {
      const m = (r.meta ?? {}) as Record<string, unknown>;
      return {
        value: String(r.value ?? ""),
        label: String(r.label ?? r.value ?? ""),
        accountingLines: Array.isArray(m?.accountingLines) ? (m.accountingLines as LineTemplate[]) : undefined,
      };
    });
  } catch {
    return [];
  }
}

async function verifyPolicyAccess(
  policyId: number,
  user: Awaited<ReturnType<typeof requireUser>>,
) {
  const polCols = await getPolicyColumns();
  if (user.userType === "admin" || user.userType === "internal_staff" || user.userType === "accounting") {
    const [row] = await db.select({ id: policies.id }).from(policies).where(eq(policies.id, policyId)).limit(1);
    return !!row;
  }
  if (user.userType === "agent") {
    if (!polCols.hasAgentId) return false;
    const result = await db.execute(
      sql`select 1 from "policies" where "id" = ${policyId} and "agent_id" = ${Number(user.id)} limit 1`,
    );
    const rows = Array.isArray(result) ? result : (result as any)?.rows ?? [];
    return rows.length > 0;
  }
  const rows = await db
    .select({ id: policies.id })
    .from(policies)
    .innerJoin(memberships, and(eq(memberships.organisationId, policies.organisationId), eq(memberships.userId, Number(user.id))))
    .where(eq(policies.id, policyId))
    .limit(1);
  return rows.length > 0;
}

function canEditPremiums(userType: string): boolean {
  return ["admin", "internal_staff", "accounting"].includes(userType);
}

function centsToDisplay(cents: number | null | undefined): number | null {
  if (cents === null || cents === undefined) return null;
  return cents / 100;
}

function displayToCents(val: unknown): number | null {
  if (val === null || val === undefined || val === "") return null;
  const n = Number(val);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

function rowToLineData(
  row: typeof policyPremiums.$inferSelect,
  fields: FieldDef[],
  entityLookup?: { insurers: Map<number, string>; collabs: Map<number, string> },
  fieldColumnMap?: Record<string, string>,
): LineData {
  const extra = (row.extraValues ?? {}) as Record<string, unknown>;
  const colMap = fieldColumnMap ?? buildFieldColumnMap(fields);
  const vals: Record<string, unknown> = {};
  for (const f of fields) {
    const mappedCol = colMap[f.key];
    if (mappedCol) {
      const colType = getColumnType(mappedCol);
      const rawVal = (row as Record<string, unknown>)[mappedCol];
      if (colType === "cents") {
        vals[f.key] = centsToDisplay(rawVal as number | null);
      } else if (colType === "rate") {
        vals[f.key] = rawVal !== null && rawVal !== undefined ? Number(rawVal) : null;
      } else {
        vals[f.key] = rawVal ?? null;
      }
    } else {
      vals[f.key] = extra[f.key] ?? null;
    }
  }
  let client = 0, net = 0, agent = 0;
  for (const f of fields) {
    if (!f.premiumColumn) continue;
    const lbl = f.label.toLowerCase();
    const rawVal = (row as Record<string, unknown>)[f.premiumColumn] as number | null;
    const val = centsToDisplay(rawVal) ?? 0;
    if (lbl.includes("client")) client = val;
    else if (lbl.includes("net")) net = val;
    else if (lbl.includes("agent")) agent = val;
  }
  const margin = client === 0 && net === 0 && agent === 0 ? null : client - net - agent;
  const insurerId = (row as Record<string, unknown>).insurerPolicyId as number | null ?? row.organisationId ?? null;
  return {
    lineKey: row.lineKey,
    lineLabel: row.lineLabel ?? row.lineKey,
    values: vals,
    margin,
    updatedAt: row.updatedAt,
    insurerId,
    insurerName: (insurerId && entityLookup?.insurers.get(insurerId)) || null,
    collaboratorId: row.collaboratorId ?? null,
    collaboratorName: (row.collaboratorId && entityLookup?.collabs.get(row.collaboratorId)) || null,
  };
}

function extractCollaboratorName(carExtra: Record<string, unknown> | null | undefined): string {
  if (!carExtra) return "";
  const norm = (k: string) => k.replace(/^[a-zA-Z0-9]+__?/, "").toLowerCase().replace(/[^a-z]/g, "");
  const scanForName = (obj: Record<string, unknown>): string => {
    for (const [k, v] of Object.entries(obj)) {
      const n = norm(k);
      const s = String(v ?? "").trim();
      if (!s) continue;
      if (/companyname|organisationname|orgname|fullname|displayname|coname|collconame|^name$/.test(n)) return s;
    }
    let first = "", last = "";
    for (const [k, v] of Object.entries(obj)) {
      const n = norm(k);
      const s = String(v ?? "").trim();
      if (!s) continue;
      if (!last && /lastname|surname/.test(n)) last = s;
      if (!first && /firstname|fname/.test(n)) first = s;
    }
    return (first || last) ? [last, first].filter(Boolean).join(" ") : "";
  };

  // Check insuredSnapshot first (client-like records store names here)
  const insured = (carExtra.insuredSnapshot ?? null) as Record<string, unknown> | null;
  if (insured && typeof insured === "object") {
    const name = scanForName(insured);
    if (name) return name;
  }

  // Then check packagesSnapshot
  const pkgs = (carExtra.packagesSnapshot ?? {}) as Record<string, unknown>;
  for (const data of Object.values(pkgs)) {
    if (!data || typeof data !== "object") continue;
    const vals = ("values" in (data as Record<string, unknown>)
      ? (data as { values?: Record<string, unknown> }).values
      : data) as Record<string, unknown> | undefined;
    if (!vals) continue;
    const name = scanForName(vals);
    if (name) return name;
  }
  return "";
}

async function findInsurerFlowKey(): Promise<string | null> {
  try {
    const allFields = await db.select({ value: formOptions.value, meta: formOptions.meta }).from(formOptions).where(eq(formOptions.isActive, true));
    for (const f of allFields) {
      const bare = (f.value ?? "").toLowerCase().replace(/[^a-z]/g, "");
      if (bare.includes("insurancecompany") || bare.includes("insurer") || bare.includes("insuranceco")) {
        const ep = (f.meta as Record<string, unknown> | null)?.entityPicker as { flow?: string } | undefined;
        if (ep?.flow) return ep.flow;
      }
    }
  } catch { /* ignore */ }
  // Fallback: check for common insurance flow keys
  try {
    const result = await db.execute(
      sql`SELECT 1 FROM cars WHERE (extra_attributes)::jsonb ->> 'flowKey' = 'InsuranceSet' LIMIT 1`,
    );
    const rows = Array.isArray(result) ? result : (result as any)?.rows ?? [];
    if (rows.length > 0) return "InsuranceSet";
  } catch { /* ignore */ }
  return null;
}

function extractEntityName(carExtra: Record<string, unknown> | null | undefined): string {
  return extractCollaboratorName(carExtra);
}

async function getEntityDisplayName(recordId: number): Promise<string | null> {
  try {
    const [row] = await db
      .select({ carExtra: cars.extraAttributes })
      .from(cars)
      .where(eq(cars.policyId, recordId))
      .limit(1);
    if (!row) return null;
    const name = extractEntityName(row.carExtra as Record<string, unknown> | null);
    return name || null;
  } catch { return null; }
}

async function findClientPolicies(clientRecordId: number): Promise<{ policyId: number; policyNumber: string }[]> {
  try {
    const [clientRow] = await db
      .select({ pNum: policies.policyNumber, carExtra: cars.extraAttributes })
      .from(policies)
      .leftJoin(cars, eq(cars.policyId, policies.id))
      .where(eq(policies.id, clientRecordId))
      .limit(1);
    if (!clientRow) return [];

    const clientNumber = clientRow.pNum;
    const results = await db
      .select({ pId: policies.id, pNum: policies.policyNumber })
      .from(policies)
      .leftJoin(cars, eq(cars.policyId, policies.id))
      .where(and(
        sql`((${cars.extraAttributes})::jsonb ->> 'flowKey') = 'policyset'`,
        sql`(
          ((${cars.extraAttributes})::jsonb ->> 'clientNumber') = ${clientNumber}
          OR (((${cars.extraAttributes})::jsonb -> 'insuredSnapshot') ->> 'clientPolicyNumber') = ${clientNumber}
          OR ((${cars.extraAttributes})::text ILIKE ${'%"clientNumber":"' + clientNumber + '"%'})
          OR ((${cars.extraAttributes})::text ILIKE ${'%"clientId":' + String(clientRecordId) + '%'})
        )`,
      ))
      .orderBy(desc(policies.createdAt))
      .limit(50);

    return results.map((r) => ({ policyId: r.pId, policyNumber: r.pNum }));
  } catch { return []; }
}

async function findAgentPolicies(agentRecordId: number): Promise<{ policyId: number; policyNumber: string }[]> {
  try {
    const polCols = await getPolicyColumns();
    if (!polCols.hasAgentId) return [];

    const results = await db.execute(sql`
      SELECT p.id as "policyId", p.policy_number as "policyNumber"
      FROM "policies" p
      LEFT JOIN "cars" c ON c.policy_id = p.id
      WHERE p.agent_id = ${agentRecordId}
        AND ((c.extra_attributes)::jsonb ->> 'flowKey') = 'policyset'
      ORDER BY p.created_at DESC
      LIMIT 50
    `);
    const rows = Array.isArray(results) ? results : (results as any)?.rows ?? [];
    return rows.map((r: any) => ({ policyId: Number(r.policyId), policyNumber: String(r.policyNumber) }));
  } catch { return []; }
}

/**
 * Maps user type to a premium context for role-based field filtering.
 * Admin / internal_staff / accounting see everything (returns null = no extra filter).
 * Clients only see fields tagged with "client".
 * Agents only see fields tagged with "agent".
 */
function userTypeToContext(userType: string): PremiumContext | null {
  if (["admin", "internal_staff", "accounting"].includes(userType)) return null;
  if (userType === "agent") return "agent";
  return "client";
}

/**
 * Default role-based filter when admin has not configured premiumContexts on any field.
 * Restricts visibility by matching field key/label to the user's role so that
 * clients only see "client premium" and agents only see "agent premium".
 * Currency field is always included for formatting purposes.
 */
function applyDefaultRoleFilter(fields: AccountingFieldDef[], role: PremiumContext): AccountingFieldDef[] {
  return fields.filter((f) => {
    const k = f.key.toLowerCase();
    const l = f.label.toLowerCase();
    if (k === "currency" || l === "currency") return true;
    if (role === "client") return k.includes("client") || l.includes("client");
    if (role === "agent") return k.includes("agent") || l.includes("agent");
    return true;
  });
}

/**
 * Fast path for context="self" — the record IS the premium record.
 * Only needs: own record data, entity names from linked policy, agent name.
 * Skips: policy_premiums scan, loading all collaborators/insurers, cover type options.
 */
async function handleSelfContext(
  policyId: number,
  fields: FieldDef[],
  user: { userType: string },
) {
  type AccountingRecord = {
    recordId: number; recordNumber: string; flowKey: string;
    fields: { key: string; label: string; value: unknown }[];
    createdAt: string; linkedPolicyNumber?: string;
  };
  type EntityHint = {
    insurerId: number | null; insurerName: string | null;
    collabId: number | null; collabName: string | null;
  };

  const stripPrefix = (k: string) => { const idx = k.indexOf("__"); return idx >= 0 ? k.slice(idx + 2) : k; };

  // 1) Load self record
  const [selfRow] = await db
    .select({ pId: policies.id, pNum: policies.policyNumber, pCreated: policies.createdAt, cExtra: cars.extraAttributes })
    .from(policies)
    .leftJoin(cars, eq(cars.policyId, policies.id))
    .where(eq(policies.id, policyId))
    .limit(1);

  if (!selfRow) {
    return NextResponse.json({ policyId, context: "self", fields, lines: [], coverTypeOptions: [], availableInsurers: [], availableCollabs: [], snapshotEntities: {}, accountingRecords: [], agentName: null });
  }

  const extra = (selfRow.cExtra ?? {}) as Record<string, unknown>;
  const fk = String(extra.flowKey ?? "");
  const pkgs = (extra.packagesSnapshot ?? {}) as Record<string, unknown>;

  // Extract record fields
  const allVals = new Map<string, unknown>();
  for (const pkgData of Object.values(pkgs)) {
    if (!pkgData || typeof pkgData !== "object") continue;
    const vals = ("values" in (pkgData as Record<string, unknown>)
      ? (pkgData as { values?: Record<string, unknown> }).values
      : pkgData) as Record<string, unknown> | undefined;
    if (!vals) continue;
    for (const [k, v] of Object.entries(vals)) {
      if (v === undefined || v === null || v === "") continue;
      allVals.set(k, v);
      allVals.set(stripPrefix(k), v);
    }
  }
  const recFields: { key: string; label: string; value: unknown }[] = [];
  for (const f of fields) {
    if (recFields.some((rf) => rf.key === f.key)) continue;
    const v = allVals.get(f.key) ?? allVals.get(`premiumRecord__${f.key}`) ?? allVals.get(`accounting__${f.key}`);
    if (v !== undefined && v !== null && v !== "") {
      recFields.push({ key: f.key, label: f.label, value: v });
    }
  }

  const accountingRecords: AccountingRecord[] = recFields.length > 0
    ? [{ recordId: selfRow.pId, recordNumber: selfRow.pNum, flowKey: fk, fields: recFields, createdAt: selfRow.pCreated }]
    : [];

  // 2) Find linked policy number from policyReference field
  const polRefField = recFields.find(
    (f) => f.key.toLowerCase().includes("policyref") || f.key.toLowerCase().includes("policy_ref"),
  );
  const linkedNum = typeof polRefField?.value === "string" ? polRefField.value.trim() : null;
  let linkedPolicyId: number | null = null;
  if (linkedNum) {
    try {
      const [lp] = await db.select({ id: policies.id }).from(policies).where(eq(policies.policyNumber, linkedNum)).limit(1);
      if (lp) linkedPolicyId = lp.id;
    } catch { /* ignore */ }
  }

  // 3) Resolve entities from linked policy's snapshot (much faster than loading all entities)
  const snapshotEntities: Record<string, EntityHint> = {};
  const entitySourceId = linkedPolicyId ?? policyId;
  try {
    const [carRow] = await db
      .select({ extra: cars.extraAttributes })
      .from(cars)
      .where(eq(cars.policyId, entitySourceId))
      .limit(1);
    const carExtra = (carRow?.extra ?? {}) as Record<string, unknown>;
    const srcPkgs = (carExtra.packagesSnapshot ?? {}) as Record<string, unknown>;

    const bare = (s: string) => s.replace(/^[a-zA-Z0-9]+__?/, "").toLowerCase().replace(/[^a-z]/g, "");
    const isOdKey = (k: string) => {
      const b = bare(k); return b.endsWith("pd") || b.endsWith("od") || b.includes("owndamage") || b.includes("ownvehicle");
    };
    const isInsurerKey = (k: string) => {
      const b = bare(k);
      return b.includes("insurancecompany") || b.includes("insurer") || b.includes("insuranceco") || b.includes("inscompany") || b.includes("inssection");
    };
    const isCollabKey = (k: string) => {
      const b = bare(k);
      return b.includes("collorator") || b.includes("collaborator") || b.includes("collabrator");
    };

    // Load ONLY the entities referenced, not all entities in the system
    const collabNames = new Map<string, { id: number; name: string }>();
    const insurerNames = new Map<string, { id: number; name: string }>();

    // Collect candidate entity names from snapshot fields
    const candidateInsurers: string[] = [];
    const candidateCollabs: string[] = [];
    for (const data of Object.values(srcPkgs)) {
      if (!data || typeof data !== "object") continue;
      const vals = ("values" in (data as Record<string, unknown>)
        ? (data as { values?: Record<string, unknown> }).values
        : data) as Record<string, unknown> | undefined;
      if (!vals) continue;
      for (const [k, v] of Object.entries(vals)) {
        if (typeof v !== "string" || !v.trim()) continue;
        if (isInsurerKey(k)) candidateInsurers.push(v.trim());
        if (isCollabKey(k)) candidateCollabs.push(v.trim());
      }
    }

    // Look up only the referenced collaborators/insurers by name (targeted queries)
    if (candidateCollabs.length > 0) {
      try {
        const collabRows = await db
          .select({ policyId: policies.id, carExtra: cars.extraAttributes })
          .from(policies)
          .leftJoin(cars, eq(cars.policyId, policies.id))
          .where(sql`(cars.extra_attributes)::jsonb ->> 'flowKey' = 'collaboratorSet'`)
          .limit(50);
        for (const r of collabRows) {
          const name = extractCollaboratorName(r.carExtra as Record<string, unknown> | null);
          if (name) collabNames.set(name.toLowerCase(), { id: r.policyId, name });
        }
      } catch { /* ignore */ }
    }
    if (candidateInsurers.length > 0) {
      const ifk = await findInsurerFlowKey();
      if (ifk) {
        try {
          const insurerRows = await db
            .select({ policyId: policies.id, carExtra: cars.extraAttributes })
            .from(policies)
            .leftJoin(cars, eq(cars.policyId, policies.id))
            .where(sql`(cars.extra_attributes)::jsonb ->> 'flowKey' = ${ifk}`)
            .limit(50);
          for (const r of insurerRows) {
            const name = extractEntityName(r.carExtra as Record<string, unknown> | null);
            if (name) insurerNames.set(name.toLowerCase(), { id: r.policyId, name });
          }
        } catch { /* ignore */ }
      }
    }

    const matchInsurer = (val: string) => {
      const lower = val.toLowerCase().trim();
      if (!lower) return null;
      const exact = insurerNames.get(lower);
      if (exact) return exact;
      for (const [name, entity] of insurerNames) { if (lower.includes(name) || name.includes(lower)) return entity; }
      return null;
    };
    const matchCollab = (val: string) => {
      const lower = val.toLowerCase().trim();
      if (!lower) return null;
      const exact = collabNames.get(lower);
      if (exact) return exact;
      for (const [name, entity] of collabNames) { if (lower.includes(name) || name.includes(lower)) return entity; }
      return null;
    };
    const ensureHint = (hint: string) => {
      if (!snapshotEntities[hint]) snapshotEntities[hint] = { insurerId: null, insurerName: null, collabId: null, collabName: null };
      return snapshotEntities[hint];
    };

    for (const data of Object.values(srcPkgs)) {
      if (!data || typeof data !== "object") continue;
      const vals = ("values" in (data as Record<string, unknown>)
        ? (data as { values?: Record<string, unknown> }).values
        : data) as Record<string, unknown> | undefined;
      if (!vals) continue;
      for (const [k, v] of Object.entries(vals)) {
        if (typeof v !== "string" || !v.trim()) continue;
        const hint = isOdKey(k) ? "od" : "main";
        const entry = ensureHint(hint);
        if (isInsurerKey(k) && !entry.insurerId) { const ins = matchInsurer(v); if (ins) { entry.insurerId = ins.id; entry.insurerName = ins.name; } }
        if (isCollabKey(k) && !entry.collabId) { const col = matchCollab(v); if (col) { entry.collabId = col.id; entry.collabName = col.name; } }
      }
    }
    // Pass 2 fallback
    for (const data of Object.values(srcPkgs)) {
      if (!data || typeof data !== "object") continue;
      const vals = ("values" in (data as Record<string, unknown>)
        ? (data as { values?: Record<string, unknown> }).values
        : data) as Record<string, unknown> | undefined;
      if (!vals) continue;
      for (const [k, v] of Object.entries(vals)) {
        if (typeof v !== "string" || !v.trim()) continue;
        if (isInsurerKey(k) || isCollabKey(k)) continue;
        const hint = isOdKey(k) ? "od" : "main";
        const entry = ensureHint(hint);
        if (!entry.insurerId) { const ins = matchInsurer(v); if (ins) { entry.insurerId = ins.id; entry.insurerName = ins.name; } }
        if (!entry.collabId) { const col = matchCollab(v); if (col) { entry.collabId = col.id; entry.collabName = col.name; } }
      }
    }
  } catch { /* non-fatal */ }

  // 4) Resolve agent from linked policy (or self)
  let agentName: string | null = null;
  try {
    const polCols = await getPolicyColumns();
    if (polCols.hasAgentId) {
      const agentSourceId = linkedPolicyId ?? policyId;
      const agentRes = await db.execute(sql`
        select u.name, u.user_number as "userNumber"
        from "policies" p left join "users" u on u.id = p.agent_id
        where p.id = ${agentSourceId} limit 1
      `);
      const ar = Array.isArray(agentRes) ? agentRes : (agentRes as any)?.rows ?? [];
      if (ar.length > 0) {
        const r = ar[0] as { name?: string; userNumber?: string };
        const parts = [r.userNumber, r.name].filter(Boolean);
        agentName = parts.length > 0 ? parts.join(" — ") : null;
      }
    }
  } catch { /* ignore */ }

  return NextResponse.json({
    policyId, context: "self", fields,
    lines: [], coverTypeOptions: [], availableInsurers: [], availableCollabs: [],
    snapshotEntities, accountingRecords, agentName,
  });
}

export async function GET(request: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { id: idParam } = await ctx.params;
    const policyId = Number(idParam);
    if (!Number.isFinite(policyId) || policyId <= 0) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    const hasAccess = await verifyPolicyAccess(policyId, user);
    if (!hasAccess) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const url = new URL(request.url);
    const context = (url.searchParams.get("context") ?? "policy") as PremiumContext;

    const allFields = await loadAccountingFields();

    // Role-based filtering: non-admin users only see fields tagged for their role
    const roleContext = userTypeToContext(user.userType);
    let fields = filterFieldsByContext(allFields, context);
    if (roleContext) {
      const anyFieldHasContexts = allFields.some((f) => f.premiumContexts && f.premiumContexts.length > 0);
      if (anyFieldHasContexts) {
        fields = filterFieldsByContext(fields, roleContext);
      } else {
        fields = applyDefaultRoleFilter(fields, roleContext);
      }
    }

    // --- Fast path for "self" context: only needs own record + entity resolution ---
    if (context === "self") {
      return await handleSelfContext(policyId, fields, user);
    }

    const coverTypeOptions = await loadCoverTypeOptions();

    let rows: (typeof policyPremiums.$inferSelect)[] = [];
    try {
      rows = await db.select().from(policyPremiums).where(eq(policyPremiums.policyId, policyId)).orderBy(policyPremiums.createdAt);
    } catch { /* table may not exist */ }

    // Load available collaborators from collaboratorSet flow
    let availableCollabs: { id: number; name: string }[] = [];
    try {
      const collabRows = await db
        .select({ policyId: policies.id, carExtra: cars.extraAttributes })
        .from(policies)
        .leftJoin(cars, eq(cars.policyId, policies.id))
        .where(sql`(cars.extra_attributes)::jsonb ->> 'flowKey' = 'collaboratorSet'`)
        .orderBy(policies.createdAt);
      availableCollabs = collabRows.map((r) => ({
        id: r.policyId,
        name: extractCollaboratorName(r.carExtra as Record<string, unknown> | null) || `Collaborator #${r.policyId}`,
      }));
    } catch { /* ignore */ }

    // Load available insurers from their flow (NOT from organisations table)
    let availableInsurers: { id: number; name: string }[] = [];
    const insurerFlowKey = await findInsurerFlowKey();
    if (insurerFlowKey) {
      try {
        const insurerRows = await db
          .select({ policyId: policies.id, carExtra: cars.extraAttributes })
          .from(policies)
          .leftJoin(cars, eq(cars.policyId, policies.id))
          .where(sql`(cars.extra_attributes)::jsonb ->> 'flowKey' = ${insurerFlowKey}`)
          .orderBy(policies.createdAt);
        availableInsurers = insurerRows.map((r) => ({
          id: r.policyId,
          name: extractEntityName(r.carExtra as Record<string, unknown> | null) || `Insurance Co. #${r.policyId}`,
        }));
      } catch { /* ignore */ }
    }

    // Build entity lookup maps for saved line references
    const insurerIds = [...new Set(rows.map((r) => (r as Record<string, unknown>).insurerPolicyId as number | null ?? r.organisationId).filter(Boolean))] as number[];
    const collabIds = [...new Set(rows.map((r) => r.collaboratorId).filter(Boolean))] as number[];
    const insurers = new Map<number, string>();
    const collabs = new Map<number, string>();

    // Lookup insurer names from flow entities
    for (const ins of availableInsurers) insurers.set(ins.id, ins.name);
    // For any IDs not found in flow (legacy organisationId refs), check organisations table
    const missingInsurerIds = insurerIds.filter((id) => !insurers.has(id));
    if (missingInsurerIds.length) {
      try {
        const orgRows = await db.select({ id: organisations.id, name: organisations.name }).from(organisations).where(sql`"id" = ANY(${missingInsurerIds})`);
        for (const o of orgRows) { if (!insurers.has(o.id)) insurers.set(o.id, o.name); }
      } catch { /* ignore */ }
      // Also check if they're flow policy IDs not in availableInsurers
      const stillMissing = missingInsurerIds.filter((id) => !insurers.has(id));
      if (stillMissing.length) {
        try {
          const rows2 = await db
            .select({ policyId: policies.id, carExtra: cars.extraAttributes })
            .from(policies)
            .leftJoin(cars, eq(cars.policyId, policies.id))
            .where(sql`"policies"."id" = ANY(${stillMissing})`);
          for (const r of rows2) {
            if (!insurers.has(r.policyId)) {
              insurers.set(r.policyId, extractEntityName(r.carExtra as Record<string, unknown> | null) || `#${r.policyId}`);
            }
          }
        } catch { /* ignore */ }
      }
    }

    if (collabIds.length) {
      for (const c of availableCollabs) { if (collabIds.includes(c.id)) collabs.set(c.id, c.name); }
      const missingCollabIds = collabIds.filter((id) => !collabs.has(id));
      if (missingCollabIds.length) {
        const collabRows = await db
          .select({ policyId: policies.id, carExtra: cars.extraAttributes })
          .from(policies)
          .leftJoin(cars, eq(cars.policyId, policies.id))
          .where(sql`"policies"."id" = ANY(${missingCollabIds})`);
        for (const c of collabRows) {
          collabs.set(c.policyId, extractCollaboratorName(c.carExtra as Record<string, unknown> | null) || `#${c.policyId}`);
        }
      }
    }

    const entityLookup = { insurers, collabs };
    const fieldColumnMap = buildFieldColumnMap(fields);
    const lines: LineData[] = rows.map((r) => rowToLineData(r, fields, entityLookup, fieldColumnMap));

    // Infer insurer/collab from policy snapshot using field-key semantics
    type EntityHint = { insurerId: number | null; insurerName: string | null; collabId: number | null; collabName: string | null };
    const snapshotEntities: Record<string, EntityHint> = {};

    const bare = (s: string) => s.replace(/^[a-zA-Z0-9]+__?/, "").toLowerCase().replace(/[^a-z]/g, "");
    const isOdKey = (k: string) => {
      const b = bare(k);
      return b.endsWith("pd") || b.endsWith("od") || b.includes("owndamage") || b.includes("ownvehicle");
    };
    const isInsurerKey = (k: string) => {
      const b = bare(k);
      return b.includes("insurancecompany") || b.includes("insurer") || b.includes("insuranceco")
        || b.includes("inscompany") || b.includes("inssection");
    };
    const isCollabKey = (k: string) => {
      const b = bare(k);
      return b.includes("collorator") || b.includes("collaborator") || b.includes("collabrator");
    };

    const insurerNameSet = new Map<string, { id: number; name: string }>();
    for (const ins of availableInsurers) insurerNameSet.set(ins.name.toLowerCase(), ins);
    const collabNameSet = new Map<string, { id: number; name: string }>();
    for (const c of availableCollabs) collabNameSet.set(c.name.toLowerCase(), c);

    const matchInsurer = (val: string): { id: number; name: string } | null => {
      const lower = val.toLowerCase().trim();
      if (!lower) return null;
      const exact = insurerNameSet.get(lower);
      if (exact) return exact;
      for (const [name, entity] of insurerNameSet) {
        if (lower.includes(name) || name.includes(lower)) return entity;
      }
      return null;
    };
    const matchCollab = (val: string): { id: number; name: string } | null => {
      const lower = val.toLowerCase().trim();
      if (!lower) return null;
      const exact = collabNameSet.get(lower);
      if (exact) return exact;
      for (const [name, entity] of collabNameSet) {
        if (lower.includes(name) || name.includes(lower)) return entity;
      }
      return null;
    };

    const resolveEntitiesFromSnapshot = async (targetPolicyId: number) => {
      const [carRow2] = await db
        .select({ extra: cars.extraAttributes })
        .from(cars)
        .where(eq(cars.policyId, targetPolicyId))
        .limit(1);
      const carExtra = (carRow2?.extra ?? {}) as Record<string, unknown>;
      const pkgs = (carExtra.packagesSnapshot ?? {}) as Record<string, unknown>;

      const ensureHint = (hint: string) => {
        if (!snapshotEntities[hint]) {
          snapshotEntities[hint] = { insurerId: null, insurerName: null, collabId: null, collabName: null };
        }
        return snapshotEntities[hint];
      };

      for (const data of Object.values(pkgs)) {
        if (!data || typeof data !== "object") continue;
        const vals = ("values" in (data as Record<string, unknown>)
          ? (data as { values?: Record<string, unknown> }).values
          : data) as Record<string, unknown> | undefined;
        if (!vals) continue;
        for (const [k, v] of Object.entries(vals)) {
          if (typeof v !== "string" || !v.trim()) continue;
          const hint = isOdKey(k) ? "od" : "main";
          const entry = ensureHint(hint);
          if (isInsurerKey(k) && !entry.insurerId) {
            const ins = matchInsurer(v);
            if (ins) { entry.insurerId = ins.id; entry.insurerName = ins.name; }
          }
          if (isCollabKey(k) && !entry.collabId) {
            const collab = matchCollab(v);
            if (collab) { entry.collabId = collab.id; entry.collabName = collab.name; }
          }
        }
      }

      for (const data of Object.values(pkgs)) {
        if (!data || typeof data !== "object") continue;
        const vals = ("values" in (data as Record<string, unknown>)
          ? (data as { values?: Record<string, unknown> }).values
          : data) as Record<string, unknown> | undefined;
        if (!vals) continue;
        for (const [k, v] of Object.entries(vals)) {
          if (typeof v !== "string" || !v.trim()) continue;
          if (isInsurerKey(k) || isCollabKey(k)) continue;
          const hint = isOdKey(k) ? "od" : "main";
          const entry = ensureHint(hint);
          if (!entry.insurerId) {
            const ins = matchInsurer(v);
            if (ins) { entry.insurerId = ins.id; entry.insurerName = ins.name; }
          }
          if (!entry.collabId) {
            const collab = matchCollab(v);
            if (collab) { entry.collabId = collab.id; entry.collabName = collab.name; }
          }
        }
      }
    };

    try { await resolveEntitiesFromSnapshot(policyId); } catch { /* non-fatal */ }

    // Find accounting flow records based on context
    type AccountingRecord = {
      recordId: number;
      recordNumber: string;
      flowKey: string;
      fields: { key: string; label: string; value: unknown }[];
      createdAt: string;
      linkedPolicyNumber?: string;
    };
    let accountingRecords: AccountingRecord[] = [];

    const stripPrefix = (k: string) => {
      const idx = k.indexOf("__");
      return idx >= 0 ? k.slice(idx + 2) : k;
    };

    const extractRecordFields = (
      lr: { pId: number; pNum: string; pCreated: string; cExtra: unknown },
    ): AccountingRecord | null => {
      const extra = (lr.cExtra ?? {}) as Record<string, unknown>;
      const fk = String(extra.flowKey ?? "");
      const pkgs = (extra.packagesSnapshot ?? {}) as Record<string, unknown>;
      const recFields: { key: string; label: string; value: unknown }[] = [];

      const allVals = new Map<string, unknown>();
      for (const [, pkgData] of Object.entries(pkgs)) {
        if (!pkgData || typeof pkgData !== "object") continue;
        const vals = ("values" in (pkgData as Record<string, unknown>)
          ? (pkgData as { values?: Record<string, unknown> }).values
          : pkgData) as Record<string, unknown> | undefined;
        if (!vals) continue;
        for (const [k, v] of Object.entries(vals)) {
          if (v === undefined || v === null || v === "") continue;
          allVals.set(k, v);
          allVals.set(stripPrefix(k), v);
        }
      }

      for (const f of fields) {
        if (recFields.some((rf) => rf.key === f.key)) continue;
        const v = allVals.get(f.key) ?? allVals.get(`premiumRecord__${f.key}`) ?? allVals.get(`accounting__${f.key}`);
        if (v !== undefined && v !== null && v !== "") {
          recFields.push({ key: f.key, label: f.label, value: v });
        }
      }

      if (recFields.length === 0) return null;
      return { recordId: lr.pId, recordNumber: lr.pNum, flowKey: fk, fields: recFields, createdAt: lr.pCreated };
    };

    try {
      if (context === "policy") {
        // Default: find accounting records that reference this policy's number
        const [policyInfo] = await db
          .select({ policyNumber: policies.policyNumber })
          .from(policies)
          .where(eq(policies.id, policyId))
          .limit(1);

        if (policyInfo?.policyNumber) {
          const pn = policyInfo.policyNumber;
          const linkedRows = await db
            .select({ pId: policies.id, pNum: policies.policyNumber, pCreated: policies.createdAt, cExtra: cars.extraAttributes })
            .from(policies)
            .leftJoin(cars, eq(cars.policyId, policies.id))
            .where(and(
              sql`((${cars.extraAttributes})::jsonb ->> 'flowKey') IS NOT NULL`,
              sql`((${cars.extraAttributes})::jsonb ->> 'flowKey') != ''`,
              sql`((${cars.extraAttributes})::jsonb ->> 'flowKey') != 'policyset'`,
              sql`(${cars.extraAttributes})::text LIKE ${'%' + pn + '%'}`,
            ))
            .orderBy(desc(policies.createdAt))
            .limit(50);

          for (const lr of linkedRows) {
            const rec = extractRecordFields(lr);
            if (rec) accountingRecords.push(rec);
          }
        }
      } else if (context === "collaborator" || context === "insurer") {
        // Find this entity's name, then search accounting records referencing it
        const entityName = await getEntityDisplayName(policyId);
        if (entityName) {
          const escapedName = entityName.replace(/[%_]/g, "\\$&");
          const linkedRows = await db
            .select({ pId: policies.id, pNum: policies.policyNumber, pCreated: policies.createdAt, cExtra: cars.extraAttributes })
            .from(policies)
            .leftJoin(cars, eq(cars.policyId, policies.id))
            .where(and(
              sql`((${cars.extraAttributes})::jsonb ->> 'flowKey') IS NOT NULL`,
              sql`((${cars.extraAttributes})::jsonb ->> 'flowKey') != ''`,
              sql`((${cars.extraAttributes})::jsonb ->> 'flowKey') != 'policyset'`,
              sql`((${cars.extraAttributes})::jsonb ->> 'flowKey') != 'collaboratorSet'`,
              sql`((${cars.extraAttributes})::jsonb ->> 'flowKey') != 'InsuranceSet'`,
              sql`(${cars.extraAttributes})::text LIKE ${'%' + escapedName + '%'}`,
            ))
            .orderBy(desc(policies.createdAt))
            .limit(100);

          for (const lr of linkedRows) {
            const rec = extractRecordFields(lr);
            if (rec) {
              // Find the linked policy number from the record's snapshot
              const extra = (lr.cExtra ?? {}) as Record<string, unknown>;
              const pkgs = (extra.packagesSnapshot ?? {}) as Record<string, unknown>;
              let linkedPolNum: string | undefined;
              for (const pkgData of Object.values(pkgs)) {
                if (!pkgData || typeof pkgData !== "object") continue;
                const vals = ("values" in (pkgData as Record<string, unknown>)
                  ? (pkgData as { values?: Record<string, unknown> }).values
                  : pkgData) as Record<string, unknown> | undefined;
                if (!vals) continue;
                for (const [k, v] of Object.entries(vals)) {
                  const bare = stripPrefix(k).toLowerCase().replace(/[^a-z]/g, "");
                  if ((bare === "policynumber" || bare === "policyno") && typeof v === "string" && v.trim()) {
                    linkedPolNum = v.trim();
                    break;
                  }
                }
                if (linkedPolNum) break;
              }
              rec.linkedPolicyNumber = linkedPolNum;
              accountingRecords.push(rec);
            }
          }
        }
      } else if (context === "client") {
        // Find all policies belonging to this client, then find their accounting records
        const clientPolicies = await findClientPolicies(policyId);
        for (const cp of clientPolicies) {
          const linkedRows = await db
            .select({ pId: policies.id, pNum: policies.policyNumber, pCreated: policies.createdAt, cExtra: cars.extraAttributes })
            .from(policies)
            .leftJoin(cars, eq(cars.policyId, policies.id))
            .where(and(
              sql`((${cars.extraAttributes})::jsonb ->> 'flowKey') IS NOT NULL`,
              sql`((${cars.extraAttributes})::jsonb ->> 'flowKey') != ''`,
              sql`((${cars.extraAttributes})::jsonb ->> 'flowKey') != 'policyset'`,
              sql`(${cars.extraAttributes})::text LIKE ${'%' + cp.policyNumber + '%'}`,
            ))
            .orderBy(desc(policies.createdAt))
            .limit(20);

          for (const lr of linkedRows) {
            const rec = extractRecordFields(lr);
            if (rec) {
              rec.linkedPolicyNumber = cp.policyNumber;
              accountingRecords.push(rec);
            }
          }
        }
      } else if (context === "agent") {
        // Find all policies assigned to this agent, then find their accounting records
        const agentPolicies = await findAgentPolicies(policyId);
        for (const ap of agentPolicies) {
          const linkedRows = await db
            .select({ pId: policies.id, pNum: policies.policyNumber, pCreated: policies.createdAt, cExtra: cars.extraAttributes })
            .from(policies)
            .leftJoin(cars, eq(cars.policyId, policies.id))
            .where(and(
              sql`((${cars.extraAttributes})::jsonb ->> 'flowKey') IS NOT NULL`,
              sql`((${cars.extraAttributes})::jsonb ->> 'flowKey') != ''`,
              sql`((${cars.extraAttributes})::jsonb ->> 'flowKey') != 'policyset'`,
              sql`(${cars.extraAttributes})::text LIKE ${'%' + ap.policyNumber + '%'}`,
            ))
            .orderBy(desc(policies.createdAt))
            .limit(20);

          for (const lr of linkedRows) {
            const rec = extractRecordFields(lr);
            if (rec) {
              rec.linkedPolicyNumber = ap.policyNumber;
              accountingRecords.push(rec);
            }
          }
        }
      }
    } catch { /* non-fatal */ }

    // Resolve agent name for this policy (visible to all users — it's a contact reference)
    let agentName: string | null = null;
    if (context === "policy") {
      const polCols2 = await getPolicyColumns();
      if (polCols2.hasAgentId) {
        try {
          const agentRes = await db.execute(sql`
            select u.name, u.user_number as "userNumber"
            from "policies" p
            left join "users" u on u.id = p.agent_id
            where p.id = ${policyId}
            limit 1
          `);
          const ar = Array.isArray(agentRes) ? agentRes : (agentRes as any)?.rows ?? [];
          if (ar.length > 0) {
            const r = ar[0] as { name?: string; userNumber?: string };
            const parts = [r.userNumber, r.name].filter(Boolean);
            agentName = parts.length > 0 ? parts.join(" — ") : null;
          }
        } catch { /* ignore */ }
      }
    }

    return NextResponse.json({
      policyId,
      context,
      fields,
      lines: context === "policy" ? lines : [],
      coverTypeOptions: context === "policy" ? coverTypeOptions : [],
      availableInsurers: context === "policy" ? availableInsurers : [],
      availableCollabs: context === "policy" ? availableCollabs : [],
      snapshotEntities: context === "policy" ? snapshotEntities : {},
      accountingRecords,
      agentName,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function PUT(request: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    if (!canEditPremiums(user.userType)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id: idParam } = await ctx.params;
    const policyId = Number(idParam);
    if (!Number.isFinite(policyId) || policyId <= 0) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const hasAccess = await verifyPolicyAccess(policyId, user);
    if (!hasAccess) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const body = await request.json();
    const lineKey = typeof body.lineKey === "string" && body.lineKey.trim() ? body.lineKey.trim() : "main";
    const lineLabel = typeof body.lineLabel === "string" && body.lineLabel.trim() ? body.lineLabel.trim() : null;
    const incomingValues = (body.values ?? {}) as Record<string, unknown>;
    const fields = await loadAccountingFields();
    const fieldColumnMap = buildFieldColumnMap(fields);

    const structuredColumns: Record<string, unknown> = {};
    const extraValues: Record<string, unknown> = {};

    for (const f of fields) {
      const val = incomingValues[f.key];
      const mappedCol = fieldColumnMap[f.key];
      if (mappedCol) {
        const colType = getColumnType(mappedCol);
        if (colType === "cents") {
          structuredColumns[mappedCol] = displayToCents(val);
        } else if (colType === "rate") {
          const n = Number(val);
          structuredColumns[mappedCol] = Number.isFinite(n) ? n.toFixed(2) : null;
        } else {
          structuredColumns[mappedCol] = typeof val === "string" && val.trim() ? val.trim() : null;
        }
      } else {
        extraValues[f.key] = val === "" ? null : (val ?? null);
      }
    }

    const insurerId = Number(body.insurerId);
    const collabId = Number(body.collaboratorId);

    const dbPayload: Record<string, unknown> = {
      lineLabel,
      currency: (structuredColumns.currency as string) ?? "HKD",
      insurerPolicyId: Number.isFinite(insurerId) && insurerId > 0 ? insurerId : null,
      collaboratorId: Number.isFinite(collabId) && collabId > 0 ? collabId : null,
      grossPremiumCents: structuredColumns.grossPremiumCents ?? null,
      netPremiumCents: structuredColumns.netPremiumCents ?? null,
      clientPremiumCents: structuredColumns.clientPremiumCents ?? null,
      agentCommissionCents: structuredColumns.agentCommissionCents ?? null,
      commissionRate: structuredColumns.commissionRate ?? null,
      extraValues: Object.keys(extraValues).length > 0 ? extraValues : null,
      updatedBy: Number(user.id),
      updatedAt: new Date().toISOString(),
    };

    const [existing] = await db
      .select({ id: policyPremiums.id })
      .from(policyPremiums)
      .where(and(eq(policyPremiums.policyId, policyId), eq(policyPremiums.lineKey, lineKey)))
      .limit(1);

    let row;
    const isUpdate = !!existing;
    if (isUpdate) {
      [row] = await db.update(policyPremiums).set(dbPayload).where(and(eq(policyPremiums.policyId, policyId), eq(policyPremiums.lineKey, lineKey))).returning();
    } else {
      [row] = await db.insert(policyPremiums).values({ policyId, lineKey, ...dbPayload }).returning();
    }

    const auditChanges: { key: string; from: unknown; to: unknown }[] = [];
    const sectionLabel = lineLabel || lineKey;
    for (const f of fields) {
      const val = incomingValues[f.key];
      if (val !== null && val !== undefined && val !== "" && val !== 0) {
        auditChanges.push({
          key: `accounting_${sectionLabel}_${f.label}`,
          from: isUpdate ? undefined : null,
          to: val,
        });
      }
    }
    if (auditChanges.length > 0) {
      const userEmail = (user as unknown as { email?: string }).email ?? "";
      try {
        await appendPolicyAudit(policyId, { id: Number(user.id), email: userEmail }, auditChanges);
      } catch { /* non-fatal */ }
    }

    return NextResponse.json({ policyId, line: rowToLineData(row, fields, undefined, fieldColumnMap) });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function DELETE(request: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    if (!canEditPremiums(user.userType)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id: idParam } = await ctx.params;
    const policyId = Number(idParam);
    if (!Number.isFinite(policyId) || policyId <= 0) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const url = new URL(request.url);
    const lineKey = url.searchParams.get("lineKey") ?? "";
    if (!lineKey) return NextResponse.json({ error: "lineKey is required" }, { status: 400 });

    const hasAccess = await verifyPolicyAccess(policyId, user);
    if (!hasAccess) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await db.delete(policyPremiums).where(and(eq(policyPremiums.policyId, policyId), eq(policyPremiums.lineKey, lineKey)));
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
