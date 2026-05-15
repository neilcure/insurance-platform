/**
 * Denormalized policy date columns — read-optimization helper.
 *
 * Background
 * ----------
 * The Policy Calendar widget needs to find every active policy whose
 * `startDate` or `endDate` falls in a window (typically ±18 months
 * from today). Those dates live inside `cars.extra_attributes ->
 * packagesSnapshot -> policy -> values -> startDate / endDate` as
 * strings in either `YYYY-MM-DD` (HTML5 date input) or `DD-MM-YYYY`
 * (formula-evaluated import). They cannot be indexed efficiently in
 * Postgres because:
 *
 *   1. JSON-path expression indexes index a single canonical
 *      expression — they can't normalise two date formats.
 *   2. `to_date(...)` only accepts one format string; mixing formats
 *      breaks the index.
 *
 * The fix is to materialise normalised `date` values into two new
 * columns on `policies` — `start_date_indexed` and
 * `end_date_indexed` — every time `cars.extra_attributes` is
 * written. Partial indexes on `is_active = true` make the calendar's
 * window scan an O(log N) lookup instead of an O(N) table scan.
 *
 * Contract
 * --------
 *   - These columns are NEVER read by application logic — they are
 *     ONLY used by the SQL-side window filter in
 *     `app/api/policies/expiring/route.ts`. All user-facing surfaces
 *     keep reading the JSONB snapshot via
 *     `lib/policies/date-extract.ts` (the source of truth).
 *   - `derivePolicyIndexedDates(extra)` returns ISO-8601
 *     `YYYY-MM-DD` strings (or `null`) matching Postgres's `date`
 *     parsing rules.
 *   - `syncPolicyIndexedDates(tx, policyId, extra)` updates the
 *     parent `policies` row. Safe to call with any drizzle handle
 *     (real `db` or a transaction `tx`) — they share the same shape.
 *   - Wrapped in defensive try/catch in CALLERS: legacy DBs without
 *     the column should NOT block policy creation/edit. Once
 *     migration 0015 runs, the catch path is unreachable.
 *
 * See also
 * --------
 *   - `db/migrations/0015_add_policy_indexed_dates.sql`
 *   - `lib/policies/date-extract.ts` (extracts raw string from snapshot)
 *   - `lib/format/date.ts` (`parseAnyDate` handles both formats)
 *   - `scripts/backfill-policy-indexed-dates.ts` (one-time backfill)
 */

import { sql } from "drizzle-orm";
import { extractDateField } from "@/lib/policies/date-extract";
import { parseAnyDate } from "@/lib/format/date";
import { getPolicyColumns } from "@/lib/db/column-check";

export type IndexedDates = {
  startDate: string | null;
  endDate: string | null;
};

/**
 * Normalise an arbitrary raw date string from the snapshot into
 * Postgres `date` literal format (`YYYY-MM-DD`). Returns `null`
 * when the string is empty or unparseable.
 */
function toIsoDate(raw: string): string | null {
  if (!raw) return null;
  const d = parseAnyDate(raw);
  if (!d) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/**
 * Derive `{ startDate, endDate }` ISO strings from a
 * `cars.extra_attributes` snapshot. Walks the package list via
 * `extractDateField` (so it picks up admin-configured key variants
 * like `policyinfo__startedDate`, `effectiveDate`, etc.) and
 * normalises the format via `parseAnyDate`.
 *
 * Pure — safe to call from any context.
 */
export function derivePolicyIndexedDates(
  extra: Record<string, unknown> | null | undefined,
): IndexedDates {
  if (!extra || typeof extra !== "object") {
    return { startDate: null, endDate: null };
  }
  return {
    startDate: toIsoDate(extractDateField(extra, "startDate")),
    endDate: toIsoDate(extractDateField(extra, "endDate")),
  };
}

/**
 * Minimal structural type for a drizzle handle that can run
 * `.execute(sql\`...\`)`. Accepts both the shared `db` proxy AND a
 * transaction `tx` from `db.transaction((tx) => ...)`, since both
 * expose the same method. Using raw SQL through `execute()` lets
 * us avoid drizzle generic-type incompatibilities between the
 * proxied DB and its transaction objects.
 */
export type ExecutableDb = {
  execute: (query: ReturnType<typeof sql>) => Promise<unknown>;
};

/**
 * Update `policies.{start_date_indexed, end_date_indexed}` for one
 * row based on the new `cars.extra_attributes` payload.
 *
 * Idempotent. Safe to call after every write to `extra_attributes`.
 *
 * CRITICAL: this helper CHECKS for column existence FIRST and
 * returns early if migration 0015 has not yet been applied. Why
 * this matters:
 *
 *   - The POST `/api/policies` flow calls this inside
 *     `db.transaction(async (tx) => {...})`. If the UPDATE fails
 *     because the column doesn't exist, Postgres marks the entire
 *     transaction as aborted. A subsequent COMMIT will fail and the
 *     policy creation rolls back — i.e. the user can't create
 *     policies at all on a pre-migration DB. A plain `try/catch`
 *     INSIDE the helper would NOT save the transaction in that
 *     case — only avoiding the failing statement does.
 *
 *   - Once `getPolicyColumns()` confirms the columns exist (cached
 *     per-process after the first call), every subsequent invocation
 *     skips the lookup and runs at full speed.
 *
 * Pass the same drizzle handle you used for the surrounding
 * operation (the `tx` parameter inside `db.transaction(...)` if you
 * want this update to participate in the transaction, otherwise the
 * shared `db`).
 */
export async function syncPolicyIndexedDates(
  tx: ExecutableDb,
  policyId: number,
  extra: Record<string, unknown> | null | undefined,
): Promise<void> {
  if (!Number.isFinite(policyId) || policyId <= 0) return;

  // Guard against pre-migration DBs — see header comment for why
  // this MUST happen before issuing the UPDATE, not in a try/catch.
  let cols;
  try {
    cols = await getPolicyColumns();
  } catch {
    return; // column-check itself failed; safe to skip
  }
  if (!cols.hasStartDateIndexed || !cols.hasEndDateIndexed) {
    return;
  }

  const { startDate, endDate } = derivePolicyIndexedDates(extra);
  try {
    await tx.execute(sql`
      UPDATE "policies"
      SET "start_date_indexed" = ${startDate}::date,
          "end_date_indexed"   = ${endDate}::date
      WHERE "id" = ${policyId}
    `);
  } catch (err) {
    // The columns exist (we just checked) so this branch should
    // really only fire for transient connection issues. The
    // calendar's SQL filter has a NULL fallback that keeps the
    // row visible if the sync fails, so swallowing is safe.
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.warn(`[indexed-dates] sync failed for policy ${policyId}:`, err);
    }
  }
}
