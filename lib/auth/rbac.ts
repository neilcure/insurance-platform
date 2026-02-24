import { and, eq } from "drizzle-orm";
import type { SessionUser } from "@/lib/auth/require-user";
import { memberships } from "@/db/schema/core";
import { policies } from "@/db/schema/insurance";

export function canCreatePolicy(user: SessionUser): boolean {
  return user.userType === "admin" || user.userType === "agent" || user.userType === "internal_staff";
}

export function canReadPolicies(user: SessionUser): boolean {
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


