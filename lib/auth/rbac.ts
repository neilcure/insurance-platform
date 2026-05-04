import { and, eq } from "drizzle-orm";
import type { SessionUser } from "@/lib/auth/require-user";
import { db } from "@/db/client";
import { memberships } from "@/db/schema/core";
import { policies } from "@/db/schema/insurance";

export function canCreatePolicy(user: SessionUser): boolean {
  return user.userType === "admin" || user.userType === "agent" || user.userType === "internal_staff";
}

export function canReadPolicies(_user: SessionUser): boolean {
  return true; // everyone can read within their scope
}

/**
 * Returns a predicate to scope policy queries to the user's access.
 * Admin and insurer_staff: no restriction (return undefined).
 * Others: policies where user has membership in the policy's organisation.
 */
export function policyScopeWhere(user: SessionUser) {
  if (user.userType === "admin" || user.userType === "internal_staff") {
    return undefined as unknown as any;
  }
  // We enforce via a join with memberships: memberships.userId = user.id AND memberships.organisationId = policies.organisationId
  return and(eq(memberships.userId, Number(user.id)), eq(memberships.organisationId, policies.organisationId));
}

/**
 * True when `user` has effective access to data scoped under `organisationId`.
 *
 * - `admin` and `internal_staff` are global and always pass.
 * - Everyone else must hold a `memberships` row for `(userId, organisationId)`.
 *
 * This is the canonical org-scope check. Use it from API routes that take
 * an `organisationId` from the request body / query / params before doing
 * any insert/update against tenant-scoped tables.
 */
export async function userHasOrgAccess(
  user: SessionUser,
  organisationId: number,
): Promise<boolean> {
  if (!Number.isFinite(organisationId) || organisationId <= 0) return false;
  if (user.userType === "admin" || user.userType === "internal_staff") {
    return true;
  }
  const rows = await db
    .select({ orgId: memberships.organisationId })
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, Number(user.id)),
        eq(memberships.organisationId, organisationId),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Throws `Error("Forbidden: no access to organisation")` when the user
 * cannot act on `organisationId`. Routes can let this bubble — the global
 * try/catch turns it into a 500, or callers can `try`/`catch` and translate
 * to a 403.
 *
 * Prefer this over inline membership lookups so the rule lives in one place.
 */
export async function assertOrgAccess(
  user: SessionUser,
  organisationId: number,
): Promise<void> {
  const ok = await userHasOrgAccess(user, organisationId);
  if (!ok) {
    throw new Error("Forbidden: no access to organisation");
  }
}


