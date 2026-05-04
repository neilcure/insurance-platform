/**
 * Active organisation resolver — replaces the silent
 * "first membership / first org in DB" fallbacks that used to live
 * inline in route handlers (see `app/api/policies/route.ts` and
 * `app/api/account/organisation/route.ts`).
 *
 * Why this exists
 * ---------------
 * Several mutating routes accepted an OPTIONAL `organisationId` in
 * the body and silently fell back to the user's first membership row
 * (or, for admins, the first organisation in the database). For
 * single-org users that worked fine, but for admins or multi-org
 * users it meant a request without an explicit `organisationId`
 * could write to a SURPRISING tenant. See `docs/multi-tenancy.md`.
 *
 * Two-phase rollout
 * -----------------
 * Phase 3a (current): WARN-ONLY mode. We emit a `console.warn` every
 *   time a route hits the silent fallback path, but still return a
 *   resolved org so existing flows keep working. Tail the logs for
 *   `[active-org] silent fallback` over a release cycle to find
 *   every caller that needs to start passing `organisationId`
 *   explicitly.
 *
 * Phase 3b (future): STRICT mode. Set `STRICT_ACTIVE_ORG=1` (or
 *   remove the warn-only branch entirely) so the resolver throws a
 *   400-able error instead of falling back. Ship after the warn
 *   logs are clean.
 *
 * The helper always:
 *   - prefers the explicit `candidate` (request body / query)
 *   - falls back to `user.activeOrganisationId` from the JWT
 *   - in warn-only mode, finally falls back to first-membership /
 *     first-org-in-system, matching the legacy behavior
 *   - verifies membership for non-admin users (admins / internal_staff
 *     bypass the membership check, matching `policyScopeWhere`)
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { memberships, organisations } from "@/db/schema/core";
import type { SessionUser } from "@/lib/auth/require-user";

export class ActiveOrgError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
    this.name = "ActiveOrgError";
  }
}

function isStrictMode(): boolean {
  return process.env.STRICT_ACTIVE_ORG === "1";
}

function isAdminLike(user: SessionUser): boolean {
  return user.userType === "admin" || user.userType === "internal_staff";
}

async function userBelongsTo(userId: number, orgId: number): Promise<boolean> {
  const rows = await db
    .select({ orgId: memberships.organisationId })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.organisationId, orgId)))
    .limit(1);
  return rows.length > 0;
}

export type ResolveActiveOrgOptions = {
  /**
   * Where the call is happening — used in warn logs so we can
   * pinpoint the route that's still relying on the silent fallback.
   */
  context?: string;
};

/**
 * Resolve the organisationId this request should act against.
 *
 * Throws `ActiveOrgError` (with appropriate status):
 *   - 403 when `candidate` was provided but the user lacks membership
 *   - 400 (in strict mode only) when no candidate AND no JWT default
 *
 * In warn-only mode (default), missing-candidate falls through to the
 * legacy "first membership / first org" chain with a console.warn so
 * production traffic doesn't break while we identify callers.
 */
export async function resolveActiveOrgId(
  user: SessionUser,
  candidate: number | string | null | undefined,
  opts: ResolveActiveOrgOptions = {},
): Promise<number> {
  const ctx = opts.context ?? "unknown";

  // 1. Explicit candidate from the request — verify membership.
  if (candidate !== undefined && candidate !== null && candidate !== "") {
    const orgId = Number(candidate);
    if (!Number.isFinite(orgId) || orgId <= 0) {
      throw new ActiveOrgError(`Invalid organisationId: ${String(candidate)}`, 400);
    }
    if (isAdminLike(user)) return orgId;
    const ok = await userBelongsTo(Number(user.id), orgId);
    if (!ok) {
      throw new ActiveOrgError("Forbidden: no access to organisation", 403);
    }
    return orgId;
  }

  // 2. JWT-cached active organisation.
  if (user.activeOrganisationId) {
    return user.activeOrganisationId;
  }

  // 3. Warn-only mode — replicate the legacy fallback chain so
  //    existing flows keep working while we audit callers.
  if (isStrictMode()) {
    throw new ActiveOrgError(
      "organisationId is required (no active organisation in session)",
      400,
    );
  }

  // First membership for non-admin/internal_staff.
  if (!isAdminLike(user)) {
    const [firstMembership] = await db
      .select({ organisationId: memberships.organisationId })
      .from(memberships)
      .where(eq(memberships.userId, Number(user.id)))
      .limit(1);
    const orgId = Number(firstMembership?.organisationId);
    if (Number.isFinite(orgId) && orgId > 0) {
      // eslint-disable-next-line no-console
      console.warn(
        `[active-org] silent fallback (first membership) ctx=${ctx} userId=${user.id} orgId=${orgId} — start passing organisationId explicitly to deprecate this path`,
      );
      return orgId;
    }
  }

  // Admins-without-membership fallback: first org in the system.
  if (isAdminLike(user)) {
    const [firstOrg] = await db
      .select({ id: organisations.id })
      .from(organisations)
      .limit(1);
    const orgId = Number(firstOrg?.id);
    if (Number.isFinite(orgId) && orgId > 0) {
      // eslint-disable-next-line no-console
      console.warn(
        `[active-org] silent fallback (first org in DB) ctx=${ctx} userId=${user.id} userType=${user.userType} orgId=${orgId} — admin should explicitly choose an active organisation`,
      );
      return orgId;
    }
  }

  throw new ActiveOrgError(
    "Unable to resolve active organisation for this user",
    400,
  );
}
