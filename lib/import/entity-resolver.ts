/**
 * Resolves entity-picker references made in import rows:
 *   - "agent" pickers → user lookup by userNumber
 *   - other entity pickers (collaboratorSet / InsuranceSet / etc.)
 *     → policy lookup by policyNumber + flowKey, then snapshot copy
 *
 * If a reference can't be resolved the row is rejected with a clear error.
 * The importer never auto-creates entity records — by design (the user picked
 * "fail" over "auto-create" for missing references).
 */
import { db } from "@/db/client";
import { users } from "@/db/schema/core";
import { policies, cars } from "@/db/schema/insurance";
import { and, eq } from "drizzle-orm";
import type { ImportPolicyPayload, EntityReference } from "./payload";
import type { ImportFlowSchema } from "./schema";
import { flattenFields } from "./schema";
import { fieldColumnId } from "./excel";
import type { ValidatedRow } from "./validate";

export type EntityResolutionError = {
  /** Column id from the Excel template (for error reporting) */
  columnId: string;
  /** Human-friendly error message shown in the UI / error report */
  message: string;
};

/**
 * Per-organisation cache so that a single import batch (which can hit the
 * same insurance company on hundreds of rows) doesn't issue thousands of
 * duplicate lookups.
 */
export class EntityResolutionCache {
  private agentCache = new Map<string, number | null>();
  // key = `${flowKey}::${recordNumber}`
  private entityCache = new Map<string, Record<string, unknown> | null>();

  async resolveAgent(userNumber: string): Promise<number | null> {
    const key = userNumber.trim();
    if (!key) return null;
    if (this.agentCache.has(key)) return this.agentCache.get(key)!;
    const [row] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.userNumber, key))
      .limit(1);
    const id = row?.id ?? null;
    this.agentCache.set(key, id);
    return id;
  }

  async resolveEntitySnapshot(
    refFlow: string,
    refValue: string,
  ): Promise<Record<string, unknown> | null> {
    const key = `${refFlow}::${refValue.trim()}`;
    if (this.entityCache.has(key)) return this.entityCache.get(key)!;

    const [row] = await db
      .select({
        policyId: policies.id,
        extra: cars.extraAttributes,
      })
      .from(policies)
      .leftJoin(cars, eq(cars.policyId, policies.id))
      .where(
        and(
          eq(policies.policyNumber, refValue.trim()),
          eq(policies.flowKey, refFlow),
        ),
      )
      .limit(1);

    if (!row) {
      this.entityCache.set(key, null);
      return null;
    }
    const extra = (row.extra ?? {}) as {
      insuredSnapshot?: Record<string, unknown>;
      packagesSnapshot?: Record<string, unknown>;
    };

    // Flatten everything into one lookup map so mappings can use either
    // raw field keys ("insured__firstName") or package-qualified ones.
    const flat: Record<string, unknown> = {};
    const insured = (extra.insuredSnapshot ?? {}) as Record<string, unknown>;
    for (const [k, v] of Object.entries(insured)) flat[k] = v;
    const pkgs = (extra.packagesSnapshot ?? {}) as Record<string, unknown>;
    for (const pkgValRaw of Object.values(pkgs)) {
      const pkgVal = pkgValRaw as { values?: Record<string, unknown> } & Record<string, unknown>;
      const values = (pkgVal.values ?? pkgVal) as Record<string, unknown>;
      for (const [k, v] of Object.entries(values)) flat[k] = v;
    }
    this.entityCache.set(key, flat);
    return flat;
  }
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
      const agentId = await cache.resolveAgent(ref.refValue);
      if (!agentId) {
        errors.push({
          columnId: ref.columnId,
          message: `Agent "${ref.refValue}" not found — make sure this user number exists in the system before importing`,
        });
        continue;
      }
      payload.policy = { ...(payload.policy ?? {}), agentId };
      continue;
    }

    const snapshot = await cache.resolveEntitySnapshot(ref.refFlow, ref.refValue);
    if (!snapshot) {
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
      const sourceVal = snapshot[m.sourceField];
      if (sourceVal === undefined) continue;
      target[m.targetField] = sourceVal;
    }
  }

  return errors;
}

/**
 * Staging-time companion to `applyEntityReferences` — but this one only
 * checks "does the referenced record exist?" and pushes a HARD ERROR onto
 * the row's `errors[]` if it doesn't.
 *
 * Why hard error (not warning):
 *   The commit step would fail anyway when the same row tries to actually
 *   resolve the ref. Surfacing it during staging means admins see the problem
 *   in the review UI BEFORE clicking "Commit", so the staging promise of
 *   "ready means it'll commit" is honoured.
 *
 * Pure post-pass — never mutates row.values, only appends to row.errors.
 * Uses the shared `EntityResolutionCache` so a batch with 200 rows pointing
 * at the same insurer issues 1 query, not 200.
 *
 * Scope:
 *   • Only fields with `field.entityPicker` are checked (i.e. agent_picker
 *     and entity-picker columns).
 *   • Empty cells are skipped (gating handled by the regular Required check).
 *   • Already-erroring rows still get checked — admins want to see ALL
 *     issues at once, not one-at-a-time.
 */
export async function attachRefResolutionErrors(
  rows: ValidatedRow[],
  schema: ImportFlowSchema,
  cache: EntityResolutionCache,
): Promise<void> {
  const fields = flattenFields(schema);
  const refFields = fields.filter((f) => Boolean(f.entityPicker));
  if (refFields.length === 0) return;

  for (const row of rows) {
    for (const f of refFields) {
      const colId = fieldColumnId(f);
      const raw = row.values[colId];
      if (raw === undefined || raw === null || raw === "") continue;

      const refValue = String(raw).trim();
      if (!refValue) continue;

      // Skip duplicate work if this column already has an error message
      // (e.g. type-validation flagged it earlier).
      if (row.errors.some((e) => e.column === colId)) continue;

      const isAgent = f.entityPicker!.flow === "__agent__";
      const found = isAgent
        ? (await cache.resolveAgent(refValue)) !== null
        : (await cache.resolveEntitySnapshot(f.entityPicker!.flow, refValue)) !== null;

      if (found) continue;

      row.errors.push({
        column: colId,
        message: isAgent
          ? `Agent "${refValue}" not found — pick an existing agent or create them first`
          : `Record "${refValue}" not found in flow "${f.entityPicker!.flow}" — pick an existing record or create it first`,
      });
    }
  }
}
