/**
 * Resolve the list of `policies.id` whose start date falls in a given
 * (year, month). Used by surfaces (e.g. Accounting page) that want
 * to filter by the policy's effective period rather than the
 * invoice / record creation date.
 *
 * Why JS-side
 * -----------
 * The start date lives inside `cars.extraAttributes` (JSONB) under an
 * admin-configurable key that varies per tenant — `startDate`,
 * `startedDate`, `policyinfo__startedDate`, etc. The shared
 * `extractDateField` helper handles every variant, but is JS-only.
 * SQL-side handling would require a long COALESCE chain that breaks
 * the moment a tenant adds a new key.
 *
 * Scoping
 * -------
 * Admin / internal_staff / accounting: every org's policies.
 * Everyone else: policies in orgs they hold a membership in.
 * This matches `lib/auth/rbac.ts` policy scope rules.
 *
 * Performance
 * -----------
 * Hard-cap fetch at `FETCH_HARD_CAP` rows. Realistic tenants have far
 * fewer policies than that. Surfaces that exceed this cap should
 * switch to a tag-driven approach (e.g. a `meta.dateRole: "start"`
 * registry that lets us read the canonical column with a single
 * SQL filter).
 */

import { db } from "@/db/client";
import { cars, policies } from "@/db/schema/insurance";
import { memberships } from "@/db/schema/core";
import { and, desc, eq, sql } from "drizzle-orm";
import type { SessionUser } from "@/lib/auth/require-user";
import { extractDateField } from "@/lib/policies/date-extract";
import { parseAnyDate } from "@/lib/format/date";

const FETCH_HARD_CAP = 5000;

type ScopedRow = {
  policyId: number;
  carExtra: Record<string, unknown> | null;
};

function isAdminLike(user: SessionUser): boolean {
  return (
    user.userType === "admin" ||
    user.userType === "internal_staff" ||
    user.userType === "accounting"
  );
}

/**
 * Return the IDs of every policy in the user's scope whose start date
 * falls in the given (year, month). `month` is 1-based (1 = Jan).
 */
export async function findPolicyIdsInStartMonth(
  user: SessionUser,
  year: number,
  month: number,
): Promise<number[]> {
  if (!Number.isFinite(year) || !Number.isFinite(month)) return [];
  if (month < 1 || month > 12) return [];

  let rows: ScopedRow[] = [];
  try {
    if (isAdminLike(user)) {
      rows = (await db
        .select({
          policyId: policies.id,
          carExtra: cars.extraAttributes,
        })
        .from(policies)
        .leftJoin(cars, eq(cars.policyId, policies.id))
        .orderBy(desc(policies.createdAt), desc(policies.id))
        .limit(FETCH_HARD_CAP)) as ScopedRow[];
    } else {
      rows = (await db
        .select({
          policyId: policies.id,
          carExtra: cars.extraAttributes,
        })
        .from(policies)
        .leftJoin(cars, eq(cars.policyId, policies.id))
        .innerJoin(
          memberships,
          and(
            eq(memberships.organisationId, policies.organisationId),
            eq(memberships.userId, Number(user.id)),
          ),
        )
        .orderBy(desc(policies.createdAt), desc(policies.id))
        .limit(FETCH_HARD_CAP)) as ScopedRow[];
    }
  } catch {
    return [];
  }

  const ids: number[] = [];
  for (const r of rows) {
    const raw = extractDateField(r.carExtra, "startDate");
    if (!raw) continue;
    const parsed = parseAnyDate(raw);
    if (!parsed) continue;
    if (parsed.getFullYear() === year && parsed.getMonth() + 1 === month) {
      ids.push(r.policyId);
    }
  }
  return ids;
}

/**
 * Build a Drizzle SQL fragment that constrains
 * `accounting_invoices.id` to those linked (via invoice items OR
 * `entity_policy_id`) to one of the given policy IDs. Returns
 * `undefined` when the id list is empty so callers can short-circuit.
 *
 * `accountingInvoicesTable` is passed in (rather than imported here)
 * so this helper stays decoupled from the import graph for code that
 * doesn't need the SQL fragment.
 */
export function buildInvoiceInPolicyIdsSql(policyIds: number[]) {
  if (policyIds.length === 0) {
    // No matching policies → caller should return empty result.
    return sql`1 = 0`;
  }
  // Inline the ids as a literal list — they came from our own query
  // and are guaranteed to be integers.
  const idList = sql.raw(policyIds.join(","));
  return sql`(
    accounting_invoices.id IN (
      SELECT invoice_id FROM accounting_invoice_items WHERE policy_id IN (${idList})
    )
    OR accounting_invoices.entity_policy_id IN (${idList})
  )`;
}
