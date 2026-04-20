/**
 * Resolves entity-picker references made in import rows:
 *   - "agent" pickers → user lookup by userNumber **or full name**
 *   - other entity pickers (collaboratorSet / InsuranceSet / etc.)
 *     → policy lookup by policyNumber + flowKey, with a **fallback to
 *       display-name lookup** so admins can type "CI Plus Insurance Agency
 *       Ltd" instead of remembering "INS-0001".
 *
 * Resolved references also expose a `displayName` field so the staging
 * review UI can show the human name next to the record number.
 *
 * If a reference can't be resolved the row is rejected with a clear error.
 * The importer never auto-creates entity records — by design.
 */
import { db } from "@/db/client";
import { users } from "@/db/schema/core";
import { policies, cars } from "@/db/schema/insurance";
import { and, eq, sql } from "drizzle-orm";
import type { ImportPolicyPayload, EntityReference } from "./payload";
import type { ImportFlowSchema } from "./schema";
import { flattenFields } from "./schema";
import { fieldColumnId } from "./excel";
import type { ValidatedRow } from "./validate";
import { extractDisplayName, normaliseNameForMatch } from "./entity-display-name";

export type EntityResolutionError = {
  /** Column id from the Excel template (for error reporting) */
  columnId: string;
  /** Human-friendly error message shown in the UI / error report */
  message: string;
};

/** What the cache returns for a successful entity lookup. */
export type ResolvedEntity = {
  policyId: number;
  policyNumber: string;
  /** Best-effort display name (company / person / etc.). Empty string if none. */
  displayName: string;
  /** Flattened snapshot used for entity-picker mappings */
  flatSnapshot: Record<string, unknown>;
};

/** What the cache returns for a successful agent lookup. */
export type ResolvedAgent = {
  userId: number;
  userNumber: string;
  /** Display label e.g. "Jane Doe" or email; empty string if both missing */
  displayName: string;
};

/**
 * Per-batch cache. Saves thousands of duplicate lookups when the same
 * insurer / agent appears on hundreds of rows.
 *
 * The `entityIndex` is built **lazily**, per-flow, the first time we need a
 * name fallback for that flow — so flows the batch never references stay
 * untouched.
 */
export class EntityResolutionCache {
  private agentByKey = new Map<string, ResolvedAgent | null>();
  // key = `${flowKey}::${normalisedKey}` (either policyNumber or display name)
  private entityByKey = new Map<string, ResolvedEntity | null>();
  // Per-flow: list of all candidate records, used for name fallback. Only
  // built once per flow (and only when name fallback is actually needed).
  private flowIndex = new Map<string, ResolvedEntity[]>();
  private agentIndexLoaded = false;
  private agentIndex: ResolvedAgent[] = [];

  // ---- Agent lookup ----

  async resolveAgent(input: string): Promise<ResolvedAgent | null> {
    const raw = input.trim();
    if (!raw) return null;
    const cacheKey = raw.toLowerCase();
    if (this.agentByKey.has(cacheKey)) return this.agentByKey.get(cacheKey)!;

    // 1. Exact match by userNumber (the documented input format)
    const [exact] = await db
      .select({ id: users.id, userNumber: users.userNumber, name: users.name, email: users.email })
      .from(users)
      .where(eq(users.userNumber, raw))
      .limit(1);
    if (exact?.id) {
      const r: ResolvedAgent = {
        userId: exact.id,
        userNumber: exact.userNumber ?? raw,
        displayName: (exact.name ?? exact.email ?? "").trim(),
      };
      this.agentByKey.set(cacheKey, r);
      return r;
    }

    // 2. Fallback: case-insensitive name / email match against the agent pool.
    //    Loaded once per batch to keep this cheap.
    if (!this.agentIndexLoaded) {
      const all = await db
        .select({ id: users.id, userNumber: users.userNumber, name: users.name, email: users.email })
        .from(users)
        .where(eq(users.userType, "agent"));
      this.agentIndex = all
        .filter((u) => u.id != null)
        .map((u) => ({
          userId: u.id,
          userNumber: u.userNumber ?? "",
          displayName: (u.name ?? u.email ?? "").trim(),
        }));
      this.agentIndexLoaded = true;
    }
    const target = normaliseNameForMatch(raw);
    const found = this.agentIndex.find(
      (a) =>
        normaliseNameForMatch(a.displayName) === target ||
        normaliseNameForMatch(a.userNumber) === target,
    );
    this.agentByKey.set(cacheKey, found ?? null);
    return found ?? null;
  }

  // ---- Entity lookup ----

  async resolveEntity(refFlow: string, input: string): Promise<ResolvedEntity | null> {
    const raw = input.trim();
    if (!raw) return null;
    const cacheKey = `${refFlow}::${raw.toLowerCase()}`;
    if (this.entityByKey.has(cacheKey)) return this.entityByKey.get(cacheKey)!;

    // 1. Exact policyNumber match (the documented input format)
    const exactRow = await this.lookupByPolicyNumber(refFlow, raw);
    if (exactRow) {
      this.entityByKey.set(cacheKey, exactRow);
      return exactRow;
    }

    // 2. Fallback: display-name match across all records of this flow.
    //    Index is built once per (batch, flow).
    const index = await this.ensureFlowIndex(refFlow);
    const target = normaliseNameForMatch(raw);
    const match = index.find((r) => normaliseNameForMatch(r.displayName) === target);
    this.entityByKey.set(cacheKey, match ?? null);
    return match ?? null;
  }

  /**
   * Backwards-compat wrapper used by the existing payload-application path.
   * Returns the flat snapshot map (or null) — same as the previous behaviour.
   */
  async resolveEntitySnapshot(
    refFlow: string,
    refValue: string,
  ): Promise<Record<string, unknown> | null> {
    const r = await this.resolveEntity(refFlow, refValue);
    return r ? r.flatSnapshot : null;
  }

  // ---- Internals ----

  private async lookupByPolicyNumber(refFlow: string, refValue: string): Promise<ResolvedEntity | null> {
    const [row] = await db
      .select({
        policyId: policies.id,
        policyNumber: policies.policyNumber,
        extra: cars.extraAttributes,
      })
      .from(policies)
      .leftJoin(cars, eq(cars.policyId, policies.id))
      .where(
        and(
          eq(policies.policyNumber, refValue),
          eq(policies.flowKey, refFlow),
        ),
      )
      .limit(1);
    if (!row) return null;
    return toResolvedEntity(row.policyId, row.policyNumber, row.extra ?? null);
  }

  private async ensureFlowIndex(refFlow: string): Promise<ResolvedEntity[]> {
    if (this.flowIndex.has(refFlow)) return this.flowIndex.get(refFlow)!;
    const rows = await db
      .select({
        policyId: policies.id,
        policyNumber: policies.policyNumber,
        extra: cars.extraAttributes,
      })
      .from(policies)
      .leftJoin(cars, eq(cars.policyId, policies.id))
      .where(eq(policies.flowKey, refFlow));
    const list = rows.map((r) => toResolvedEntity(r.policyId, r.policyNumber, r.extra ?? null));
    this.flowIndex.set(refFlow, list);
    return list;
  }
}

function toResolvedEntity(
  policyId: number,
  policyNumber: string,
  extra: unknown,
): ResolvedEntity {
  const ex = (extra ?? {}) as {
    insuredSnapshot?: Record<string, unknown>;
    packagesSnapshot?: Record<string, unknown>;
  };

  // Flatten everything into one lookup map so mappings can use either
  // raw field keys ("insured__firstName") or package-qualified ones.
  const flat: Record<string, unknown> = {};
  const insured = (ex.insuredSnapshot ?? {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(insured)) flat[k] = v;
  const pkgs = (ex.packagesSnapshot ?? {}) as Record<string, unknown>;
  for (const pkgValRaw of Object.values(pkgs)) {
    const pkgVal = pkgValRaw as { values?: Record<string, unknown> } & Record<string, unknown>;
    const values = (pkgVal.values ?? pkgVal) as Record<string, unknown>;
    for (const [k, v] of Object.entries(values)) flat[k] = v;
  }

  return {
    policyId,
    policyNumber,
    displayName: extractDisplayName(ex),
    flatSnapshot: flat,
  };
}

/**
 * Apply all entity references for a single import payload.
 * Mutates the payload in place: agent → policy.agentId; entity mappings →
 * insured/package values.
 */
export async function applyEntityReferences(
  payload: ImportPolicyPayload,
  refs: EntityReference[],
  cache: EntityResolutionCache,
): Promise<EntityResolutionError[]> {
  const errors: EntityResolutionError[] = [];

  for (const ref of refs) {
    if (ref.refFlow === "__agent__") {
      const agent = await cache.resolveAgent(ref.refValue);
      if (!agent) {
        errors.push({
          columnId: ref.columnId,
          message: `Agent "${ref.refValue}" not found — make sure this user (or their userNumber) exists in the system before importing`,
        });
        continue;
      }
      payload.policy = { ...(payload.policy ?? {}), agentId: agent.userId };
      continue;
    }

    const entity = await cache.resolveEntity(ref.refFlow, ref.refValue);
    if (!entity) {
      errors.push({
        columnId: ref.columnId,
        message: `Record "${ref.refValue}" not found in flow "${ref.refFlow}" — please add it via the "${ref.refFlow}" flow first, then re-upload`,
      });
      continue;
    }

    // Apply mappings: copy source fields from the snapshot to target fields
    // in the import payload (insured snapshot or package values).
    const target =
      ref.scope === "insured"
        ? payload.insured
        : (payload.packages[ref.pkg!] ??= { values: {} }).values;

    for (const m of ref.mappings) {
      const sourceVal = entity.flatSnapshot[m.sourceField];
      if (sourceVal === undefined) continue;
      target[m.targetField] = sourceVal;
    }
  }

  return errors;
}

/**
 * Resolution payload attached to each row by `attachRefResolutionInfo`.
 * Keys are column ids; values describe what the picker resolved to.
 */
export type RowResolvedRefs = Record<
  string,
  {
    /** "ok" → resolved; "missing" → not found (already an error on the row) */
    status: "ok" | "missing";
    /** Display name (company / person). Empty string if unknown. */
    displayName: string;
    /** Resolved record number (or userNumber for agents). Empty if missing. */
    recordNumber: string;
    /** "agent" | "entity" — drives the icon/colour in the UI */
    kind: "agent" | "entity";
    /** Original raw value the user typed in the spreadsheet */
    rawInput: string;
  }
>;

/**
 * Staging-time entity-resolution pass.
 *
 * For every entity-picker / agent-picker cell on every row:
 *   • Looks the reference up via the shared cache.
 *   • If found  → emits a `RowResolvedRefs` entry so the UI can render the
 *                 company / agent name alongside the raw value.
 *   • If missing → pushes a HARD ERROR onto `row.errors` so the staging
 *                  review screen flags it before commit.
 *
 * Pure post-pass — only mutates `row.errors` (existing behaviour) and the
 * returned `Map<rowExcelRow, RowResolvedRefs>` (new). Caller decides where
 * to persist the resolved-refs payload (see `batch-service.ts`).
 *
 * Note: this replaces the older `attachRefResolutionErrors` — we keep the
 * old name as an alias below for callers that don't need the resolved map.
 */
export async function attachRefResolutionInfo(
  rows: ValidatedRow[],
  schema: ImportFlowSchema,
  cache: EntityResolutionCache,
): Promise<Map<number, RowResolvedRefs>> {
  const fields = flattenFields(schema);
  const refFields = fields.filter((f) => Boolean(f.entityPicker));
  const out = new Map<number, RowResolvedRefs>();
  if (refFields.length === 0) return out;

  for (const row of rows) {
    const refs: RowResolvedRefs = {};
    for (const f of refFields) {
      const colId = fieldColumnId(f);
      const raw = row.values[colId];
      if (raw === undefined || raw === null || raw === "") continue;

      const refValue = String(raw).trim();
      if (!refValue) continue;

      const isAgent = f.entityPicker!.flow === "__agent__";
      if (isAgent) {
        const agent = await cache.resolveAgent(refValue);
        if (agent) {
          refs[colId] = {
            status: "ok",
            displayName: agent.displayName,
            recordNumber: agent.userNumber,
            kind: "agent",
            rawInput: refValue,
          };
        } else if (!row.errors.some((e) => e.column === colId)) {
          row.errors.push({
            column: colId,
            message: `Agent "${refValue}" not found — pick an existing agent or create them first`,
          });
          refs[colId] = {
            status: "missing",
            displayName: "",
            recordNumber: "",
            kind: "agent",
            rawInput: refValue,
          };
        }
        continue;
      }

      const entity = await cache.resolveEntity(f.entityPicker!.flow, refValue);
      if (entity) {
        refs[colId] = {
          status: "ok",
          displayName: entity.displayName,
          recordNumber: entity.policyNumber,
          kind: "entity",
          rawInput: refValue,
        };
      } else if (!row.errors.some((e) => e.column === colId)) {
        row.errors.push({
          column: colId,
          message: `Record "${refValue}" not found in flow "${f.entityPicker!.flow}" — pick an existing record or create it first`,
        });
        refs[colId] = {
          status: "missing",
          displayName: "",
          recordNumber: "",
          kind: "entity",
          rawInput: refValue,
        };
      }
    }
    if (Object.keys(refs).length > 0) {
      out.set(row.excelRow, refs);
    }
  }

  // Silence unused-warning when the helper isn't needed elsewhere.
  void sql;
  return out;
}

/**
 * Backwards-compatible alias. Older callers that don't need the resolved
 * map (e.g. early tests) can keep using this name.
 */
export async function attachRefResolutionErrors(
  rows: ValidatedRow[],
  schema: ImportFlowSchema,
  cache: EntityResolutionCache,
): Promise<void> {
  await attachRefResolutionInfo(rows, schema, cache);
}
