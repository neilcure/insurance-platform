/**
 * `withAuth` — a thin wrapper for Route Handlers that runs auth +
 * (optionally) role and org-scope checks before invoking your handler.
 *
 * Why this exists
 * ---------------
 * Today every API route does roughly:
 *
 *   try {
 *     const user = await requireUser();
 *     // ... validation ...
 *     // ... business logic ...
 *   } catch (err) {
 *     console.error(...);
 *     return NextResponse.json({ error: "Server error" }, { status: 500 });
 *   }
 *
 * That has two problems:
 *
 * 1. `requireUser()` throws `Error("Unauthorized")`, which the generic
 *    catch turns into a 500 — clients see a server error instead of
 *    the correct 401, and our logs fill with bogus "Server error".
 * 2. There is no central spot to enforce "only admin can call this"
 *    or "user must belong to organisation X". Each route hand-rolls
 *    the membership check, and missing one is a silent cross-tenant
 *    leak (see `docs/multi-tenancy.md`).
 *
 * `withAuth` standardises both. It is **purely additive** — existing
 * routes keep using `requireUser()` directly and continue to work.
 * New routes (and any route you happen to be touching) should adopt
 * `withAuth` so the auth contract is consistent.
 *
 * Usage
 * -----
 * Basic — just want auth:
 *
 *   export const GET = withAuth(async (req, { user }) => {
 *     return NextResponse.json({ hello: user.id });
 *   });
 *
 * Restrict to admins:
 *
 *   export const POST = withAuth(
 *     async (req, { user }) => { ... },
 *     { allowedUserTypes: ["admin", "internal_staff"] },
 *   );
 *
 * With dynamic params (Next.js 16 async params):
 *
 *   export const GET = withAuth<{ id: string }>(
 *     async (req, { user, params }) => {
 *       const id = Number(params.id);
 *       // ...
 *     },
 *   );
 *
 * Enforce org scope from request body:
 *
 *   export const POST = withAuth(async (req, { user }) => {
 *     const body = await req.json();
 *     await assertOrgAccess(user, body.organisationId); // throws -> 403
 *     // ...
 *   });
 */

import { NextResponse } from "next/server";
import { requireUser, type SessionUser } from "@/lib/auth/require-user";

export type WithAuthHandler<TParams = unknown> = (
  request: Request,
  ctx: { user: SessionUser; params: TParams },
) => Promise<Response> | Response;

export type WithAuthOptions = {
  /**
   * If set, only these `user.userType` values are allowed. Anyone else
   * gets a 403 JSON response. Leave undefined to allow any signed-in
   * user.
   */
  allowedUserTypes?: SessionUser["userType"][];
};

type RouteCtx<TParams> = { params: Promise<TParams> };

/**
 * Wrap a Next.js Route Handler with auth + optional role enforcement.
 *
 * - 401 JSON when no valid session
 * - 403 JSON when the user's role isn't in `allowedUserTypes`
 * - Otherwise calls `handler` with `{ user, params }` injected
 */
export function withAuth<TParams = unknown>(
  handler: WithAuthHandler<TParams>,
  options: WithAuthOptions = {},
): (request: Request, ctx: RouteCtx<TParams>) => Promise<Response> {
  return async (request: Request, ctx: RouteCtx<TParams>) => {
    let user: SessionUser;
    try {
      user = await requireUser();
    } catch {
      // requireUser throws plain `Error("Unauthorized")`. Translate
      // to the correct HTTP status instead of letting the generic
      // route catch turn it into a 500.
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (
      options.allowedUserTypes &&
      options.allowedUserTypes.length > 0 &&
      !options.allowedUserTypes.includes(user.userType)
    ) {
      return NextResponse.json(
        { error: "Forbidden: insufficient role" },
        { status: 403 },
      );
    }

    // Resolve dynamic route params (Next.js 16 makes this a Promise).
    const params = (await ctx.params) as TParams;

    try {
      return await handler(request, { user, params });
    } catch (err: unknown) {
      // Translate a small set of well-known auth/scope errors into
      // the correct HTTP status. Anything else bubbles to the
      // global Next.js error boundary.
      const message =
        err instanceof Error ? err.message : String(err ?? "Unknown error");
      if (/^Forbidden/i.test(message)) {
        return NextResponse.json({ error: message }, { status: 403 });
      }
      if (/^Unauthorized/i.test(message)) {
        return NextResponse.json({ error: message }, { status: 401 });
      }
      throw err;
    }
  };
}
