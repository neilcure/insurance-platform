/**
 * Resolves or auto-creates the "client" (clientSet-flow policy) for an
 * import row. Resolution order:
 *
 *   1. Explicit Client Number → look up the existing clientSet policy
 *      and reuse it. Hard-error if not found.
 *   2. No Client Number → try to MATCH an existing client by strong
 *      identifier (CI Number for companies, HKID for personal). Reuses
 *      the existing record so re-importing rows for the same insured
 *      doesn't spawn duplicate client cards in /dashboard/clients —
 *      this was the original bug (every row created a new client even
 *      when the same person/company was already in the database).
 *   3. Still no match → auto-create a new client-policy by POSTing to
 *      /api/policies with `flowKey = clientFlowKey`.
 *
 * The actual policy creation goes through the existing internal route —
 * no duplication of business logic.
 */
import { db } from "@/db/client";
import { policies, cars } from "@/db/schema/insurance";
import { formOptions } from "@/db/schema/form_options";
import { and, eq } from "drizzle-orm";
import { serverFetch } from "@/lib/auth/server-fetch";
import { getInsuredDisplayName } from "@/lib/field-resolver";

export type ResolvedClient = {
  clientPolicyId: number;
  clientPolicyNumber: string;
  /** True if this row created a new client-policy. */
  created: boolean;
  /**
   * How the client was resolved:
   *   - "by-number": user supplied a Client Number (step 1)
   *   - "by-identity": dedupe matched an existing record by CI/HKID (step 2)
   *   - "created": no match, a new client-policy was created (step 3)
   */
  matchKind: "by-number" | "by-identity" | "created";
  /**
   * Field that produced the identity match (e.g. "ciNumber"). Only set
   * when matchKind === "by-identity". Useful for the row note shown on
   * the staging review screen.
   */
  matchedOn?: string;
};

/**
 * Strong identifiers extracted from an insured snapshot. Returned by
 * `extractIdentity` so the matcher can run a single targeted SQL query
 * instead of scanning every clientSet record.
 */
type InsuredIdentity = {
  category: "company" | "personal" | "unknown";
  /** Commercial Identity number — strong unique key for companies. */
  ciNumber?: string;
  /** Business Registration number — alt strong key for companies. */
  brNumber?: string;
  /** Hong Kong ID number — strong unique key for personal. */
  idNumber?: string;
};

/**
 * Looks up an existing clientSet-flow policy by its policy number.
 * Returns null if not found.
 */
export async function findClientByNumber(
  clientNumber: string,
  clientFlowKey: string,
): Promise<{ id: number; policyNumber: string } | null> {
  const trimmed = clientNumber.trim();
  if (!trimmed) return null;
  const rows = await db
    .select({ id: policies.id, policyNumber: policies.policyNumber })
    .from(policies)
    .where(
      and(
        eq(policies.policyNumber, trimmed),
        eq(policies.flowKey, clientFlowKey),
      ),
    )
    .limit(1);
  if (rows.length === 0) return null;
  return rows[0];
}

/**
 * Auto-creates a clientSet-flow policy from the insured snapshot.
 * Returns the new client policy id + number.
 *
 * Calls the internal POST /api/policies endpoint via serverFetch so the
 * existing creation logic (numbering, snapshots, validation) is reused.
 */
export async function autoCreateClient(
  insured: Record<string, unknown>,
  clientFlowKey: string,
): Promise<{ id: number; policyNumber: string }> {
  const res = await serverFetch("/api/policies", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ insured, flowKey: clientFlowKey }),
  });

  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    policyId?: number;
    recordId?: number;
    id?: number;
    policyNumber?: string;
    recordNumber?: string;
  };

  if (!res.ok) {
    throw new Error(body?.error ?? `Failed to auto-create client (HTTP ${res.status})`);
  }

  const id = Number(body.recordId ?? body.policyId ?? body.id ?? 0);
  const number = String(body.recordNumber ?? body.policyNumber ?? "");
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error("Auto-create client returned invalid id");
  }
  return { id, policyNumber: number };
}

/**
 * One field that participates in duplicate-client detection. The full
 * list is admin-configurable via `form_options` (group `insured_fields`,
 * `meta.dedupeIdentifier === true`) and falls back to the built-in
 * defaults below when nothing has been tagged. See `loadDedupeFields`.
 */
export type DedupeFieldConfig = {
  /** Field key as stored on the form_options row (e.g. "ciNumber"). */
  key: string;
  /**
   * Category this identifier applies to. The string is stored as-is on
   * `meta.dedupeCategory`:
   *   - "company" / "personal" → only matches against same-category clients
   *   - "any"                  → matches across all categories
   *   - any other admin-configured category value → exact category match
   * Defaults to "any" when omitted.
   */
  category: string;
};

/**
 * Built-in defaults — used ONLY when no admin has tagged any insured
 * field as a dedupe identifier. Keeps the duplicate-client check
 * working out of the box for tenants that haven't configured anything,
 * and matches the historic hardcoded behaviour exactly so existing
 * deployments see no regression.
 *
 * The MOMENT an admin tags any field with `meta.dedupeIdentifier`, this
 * fallback is bypassed and the admin's list becomes the source of truth
 * — so admins can ADD a new identifier (Mainland Unified Social Credit
 * Code, Singapore NRIC, passport number, …) by tagging that field, or
 * REMOVE one by un-tagging.
 */
export const BUILT_IN_DEDUPE_FIELDS: DedupeFieldConfig[] = [
  { key: "ciNumber", category: "company" },
  { key: "brNumber", category: "company" },
  { key: "idNumber", category: "personal" },
];

/**
 * Load the active dedupe-field list from `form_options` (insured_fields
 * group, rows tagged with `meta.dedupeIdentifier === true`). Returns
 * the built-in defaults when none are tagged so dedupe never silently
 * stops working — the admin gets a sensible default and can override.
 *
 * Per the dynamic-config-first skill: never hand-type admin-facing
 * lists. The match rule lives in admin-editable config; code only
 * branches on the SEMANTIC tag (`meta.dedupeIdentifier`).
 */
export async function loadDedupeFields(): Promise<DedupeFieldConfig[]> {
  try {
    const rows = await db
      .select({ value: formOptions.value, meta: formOptions.meta })
      .from(formOptions)
      .where(eq(formOptions.groupKey, "insured_fields"));
    const tagged: DedupeFieldConfig[] = [];
    for (const r of rows) {
      const meta = (r.meta ?? {}) as Record<string, unknown>;
      if (meta.dedupeIdentifier !== true) continue;
      const key = String(r.value ?? "").trim();
      if (!key) continue;
      const rawCat = meta.dedupeCategory;
      const category =
        typeof rawCat === "string" && rawCat.trim() ? rawCat.trim().toLowerCase() : "any";
      tagged.push({ key, category });
    }
    if (tagged.length > 0) return tagged;
  } catch {
    // form_options unreachable — fall through to defaults so dedupe
    // still works in degraded mode (better than silently disabling it).
  }
  return BUILT_IN_DEDUPE_FIELDS;
}

/**
 * Read a single normalised identifier value from an insured snapshot.
 * Tolerates BOTH the wizard's RHF key shape (`insured__ciNumber`) and
 * the legacy unprefixed form (`ciNumber`) so this works whether the
 * snapshot came from the import payload builder or a hand-rolled insert.
 *
 * Normalisation: trim + collapse internal whitespace + lower-case, so
 * "K625697A", "k625697a ", and "K6 25697 A" all map to "k625697a".
 */
function readSnapshotValue(
  insured: Record<string, unknown>,
  key: string,
): string | undefined {
  const lowerKey = key.toLowerCase();
  const candidates = [
    insured[key],
    insured[`insured__${key}`],
    insured[`insured_${key}`],
    // Case-insensitive fallback — some imports use "CINumber" or "ID_Number".
    insured[lowerKey],
    insured[`insured__${lowerKey}`],
    insured[`insured_${lowerKey}`],
  ];
  for (const v of candidates) {
    if (typeof v !== "string") continue;
    const norm = v.trim().replace(/\s+/g, "").toLowerCase();
    if (norm.length > 0) return norm;
  }
  return undefined;
}

/** Read the insured category (company / personal / …) from a snapshot. */
function readSnapshotCategory(insured: Record<string, unknown>): string {
  const raw = (insured.category ?? insured.insured__category ?? insured.insuredType) as unknown;
  return typeof raw === "string" ? raw.trim().toLowerCase() : "";
}

/**
 * @deprecated Use `loadDedupeFields()` + `readSnapshotValue()` instead.
 * Kept as a thin shim over the new dynamic mechanism so the historic
 * shape (`{ category, ciNumber, brNumber, idNumber }`) still works for
 * any external caller that might depend on it. The hardcoded keys here
 * intentionally match `BUILT_IN_DEDUPE_FIELDS` so this function returns
 * the same answer in single-tenant default mode.
 */
export function extractIdentity(insured: Record<string, unknown>): InsuredIdentity {
  const rawCat = readSnapshotCategory(insured);
  const category: InsuredIdentity["category"] =
    rawCat === "company" ? "company" : rawCat === "personal" ? "personal" : "unknown";
  return {
    category,
    ciNumber: readSnapshotValue(insured, "ciNumber"),
    brNumber: readSnapshotValue(insured, "brNumber"),
    idNumber: readSnapshotValue(insured, "idNumber") ?? readSnapshotValue(insured, "hkid"),
  };
}

/**
 * Result of a successful identity match. `displayName` and `matchedValue`
 * are populated so the wizard can render a meaningful "Use Existing Client?"
 * dialog without a second round-trip to fetch the matched record.
 */
export type IdentityMatch = {
  id: number;
  policyNumber: string;
  /** Which identifier matched: "ciNumber" | "brNumber" | "idNumber" */
  matchedOn: string;
  /** The actual value that matched (normalised). Useful for the dialog message. */
  matchedValue: string;
  /** Insured display name (e.g. "Chan Tai Man" or "Acme Ltd"). Empty if unresolvable. */
  displayName: string;
};

/**
 * Look for an existing clientSet-flow policy whose insured snapshot
 * matches the given identity on a STRONG identifier. The list of
 * "strong identifiers" is admin-configurable via `form_options` —
 * `loadDedupeFields()` returns the active configuration with built-in
 * fallbacks (CI/BR for companies, HKID for personal) when no admin has
 * tagged any field yet. Returns the first match or null.
 *
 * Implementation: JOIN policies + cars, filter by flow_key in SQL
 * (cheap), then scan the snapshot in JS to compare normalised
 * identifiers. JSONB path matching is doable in pure SQL but the
 * snapshot has 5 candidate keys per identifier (the wizard isn't
 * strict about which prefix it uses), and the JS pass keeps the
 * matching rules in ONE place — same normalisation as
 * `readSnapshotValue`, no risk of drift.
 *
 * Cost: O(N clientSet policies) per call + ONE form_options query
 * (cached at the DB connection layer if needed). For tenants with
 * <10k clients this is fine. If it becomes a hot path, swap to a
 * generated `client_identity` column + B-tree index.
 *
 * Per-field category gate:
 *   - Field tagged with `dedupeCategory: "company"` → only matches
 *     when BOTH target and candidate are company-type clients
 *   - Field tagged with `dedupeCategory: "any"` (or omitted) → matches
 *     across all categories
 *   - Legacy snapshots with no `insuredType` are treated as "unknown"
 *     and skip the category gate (relying on the strong-identifier
 *     match alone — same fail-open behaviour as the previous version)
 *
 * @param organisationId  Optional. When provided, only matches clients
 *   in the same organisation — required to prevent cross-tenant
 *   identity leaks (e.g. tenant A discovering that tenant B has a
 *   client with the same CI number). Existing import callers omit
 *   this param to preserve the previous behaviour (single-org import
 *   context).
 */
export async function findClientByIdentity(
  insured: Record<string, unknown>,
  clientFlowKey: string,
  organisationId?: number,
): Promise<IdentityMatch | null> {
  // Load the active dedupe-field config ONCE before the row scan.
  // Without this hoist, every candidate row would re-run the
  // form_options query (expensive O(N) → O(N²) DB load).
  const dedupeFields = await loadDedupeFields();

  // Pull the target (incoming) identifier values up-front so the
  // hot loop below only does Map lookups.
  type TargetIdent = { key: string; val: string; category: string };
  const targetCategory = readSnapshotCategory(insured);
  const targetIds: TargetIdent[] = [];
  for (const cfg of dedupeFields) {
    const val = readSnapshotValue(insured, cfg.key);
    if (val) targetIds.push({ key: cfg.key, val, category: cfg.category });
  }
  // No strong identifier in the row → can't match safely. (Matching by
  // name + phone would create false positives — two "John Chan"s would
  // collide. Better to create a duplicate than merge wrong records.)
  if (targetIds.length === 0) return null;

  const whereClause =
    typeof organisationId === "number" && Number.isFinite(organisationId)
      ? and(
          eq(policies.flowKey, clientFlowKey),
          eq(policies.organisationId, organisationId),
        )
      : eq(policies.flowKey, clientFlowKey);

  const rows = await db
    .select({
      id: policies.id,
      policyNumber: policies.policyNumber,
      extra: cars.extraAttributes,
    })
    .from(policies)
    .leftJoin(cars, eq(cars.policyId, policies.id))
    .where(whereClause);

  for (const row of rows) {
    const extra = (row.extra ?? {}) as { insuredSnapshot?: Record<string, unknown> };
    const snap = extra.insuredSnapshot;
    if (!snap || typeof snap !== "object") continue;
    const candidateCategory = readSnapshotCategory(snap);
    for (const t of targetIds) {
      // Per-field category gate. Only enforce when the field is scoped
      // to a specific category AND both sides have a known category —
      // legacy snapshots without `insuredType` fall through to the
      // identifier-only check (same as the previous behaviour).
      if (t.category !== "any" && t.category !== "") {
        if (targetCategory && targetCategory !== t.category) continue;
        if (candidateCategory && candidateCategory !== t.category) continue;
      }
      const candVal = readSnapshotValue(snap, t.key);
      if (candVal && candVal === t.val) {
        return {
          id: row.id,
          policyNumber: row.policyNumber,
          matchedOn: t.key,
          matchedValue: t.val,
          displayName: getInsuredDisplayName(snap),
        };
      }
    }
  }
  return null;
}

/**
 * Resolves the client for an import row — see file-level docstring for the
 * 3-step resolution order.
 */
export async function resolveOrCreateClient(params: {
  clientNumber?: string;
  insured: Record<string, unknown>;
  clientFlowKey: string;
}): Promise<ResolvedClient> {
  const { clientNumber, insured, clientFlowKey } = params;

  // STEP 1 — explicit client number wins, hard-error on miss.
  if (clientNumber) {
    const existing = await findClientByNumber(clientNumber, clientFlowKey);
    if (!existing) {
      throw new Error(`Client number "${clientNumber}" not found in flow "${clientFlowKey}"`);
    }
    return {
      clientPolicyId: existing.id,
      clientPolicyNumber: existing.policyNumber,
      created: false,
      matchKind: "by-number",
    };
  }

  // STEP 2 — identity dedupe. Only triggers when the row has a usable
  // strong identifier; otherwise we fall through to step 3 to avoid
  // false-positive merges on weak signals (name, phone).
  const matched = await findClientByIdentity(insured, clientFlowKey);
  if (matched) {
    return {
      clientPolicyId: matched.id,
      clientPolicyNumber: matched.policyNumber,
      created: false,
      matchKind: "by-identity",
      matchedOn: matched.matchedOn,
    };
  }

  // STEP 3 — no match anywhere, create a fresh client-policy.
  const created = await autoCreateClient(insured, clientFlowKey);
  return {
    clientPolicyId: created.id,
    clientPolicyNumber: created.policyNumber,
    created: true,
    matchKind: "created",
  };
}
