/**
 * POST /api/account/active-organisation
 *
 * Switch the current user's active organisation. After a successful
 * switch, the client should call NextAuth's `update()` from
 * `useSession` (or simply re-fetch the session) so the JWT cookie
 * picks up the new `activeOrganisationId` on the next request.
 *
 * Body:
 *   { "organisationId": <number> }
 *
 * Returns:
 *   { ok: true, activeOrganisationId: <number> }
 *
 * Auth:
 *   Requires a valid session. For non-admin / non-internal_staff
 *   users we verify the user has a membership in the target
 *   organisation; admins can switch to any org.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/lib/auth/with-auth";
import { resolveActiveOrgId } from "@/lib/auth/active-org";

const Body = z.object({
  organisationId: z.coerce.number().int().positive(),
});

export const POST = withAuth(async (request, { user }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "organisationId is required and must be a positive integer" },
      { status: 400 },
    );
  }

  // Reuse resolveActiveOrgId so the membership check stays in one
  // place. It throws ActiveOrgError(403) if the user can't access
  // the requested org — withAuth translates "Forbidden" to 403.
  const orgId = await resolveActiveOrgId(user, parsed.data.organisationId, {
    context: "account/active-organisation",
  });

  return NextResponse.json({ ok: true, activeOrganisationId: orgId });
});
