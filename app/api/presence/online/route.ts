/**
 * GET /api/presence/online
 *
 * Returns the list of users currently considered "online" in the
 * caller's active organisation. Powers the topbar widget.
 *
 * "Online" = heartbeated within the last `STALE_AFTER_SECONDS` seconds.
 * The cadence is set by `usePresenceHeartbeat` (~60s) so a 180s window
 * absorbs a missed beat and avoids flapping when a tab is briefly paused.
 *
 * Auth & scoping
 * --------------
 * - Always requires a valid session (`withAuth`).
 * - Only returns users that share the viewer's active organisation.
 *   Cross-tenant leak is impossible because we filter by `organisation_id`
 *   from the JWT-resolved active org, not from the request.
 * - Admins / internal_staff without a membership: we currently scope
 *   to their resolved active org (which falls back to first-org-in-DB
 *   in warn-only mode). When STRICT_ACTIVE_ORG=1 ships, those users
 *   will need to pick an org first or get an empty list.
 *
 * Response shape (sorted by lastSeenAt desc, viewer first):
 *   {
 *     ok: true,
 *     viewerId: number,
 *     count: number,           // EXCLUDES the viewer
 *     users: [
 *       {
 *         id: number,
 *         name: string | null,
 *         email: string,
 *         userType: string,
 *         lastSeenAt: ISO string,
 *         resourceKey: string | null,    // Phase B
 *         phone: string | null,          // From linked client; null for unlinked users
 *         isSelf: boolean,
 *       }
 *     ]
 *   }
 */

import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { withAuth } from "@/lib/auth/with-auth";
import { resolveActiveOrgId, ActiveOrgError } from "@/lib/auth/active-org";

const STALE_AFTER_SECONDS = 180;

type OnlineRow = {
  id: number;
  name: string | null;
  email: string;
  user_type: string;
  last_seen_at: string;
  resource_key: string | null;
  phone: string | null;
};

export const GET = withAuth(async (_request, { user }) => {
  const viewerId = Number(user.id);
  if (!Number.isFinite(viewerId) || viewerId <= 0) {
    return NextResponse.json({ error: "Invalid session user" }, { status: 401 });
  }

  let orgId: number | null = null;
  try {
    orgId = await resolveActiveOrgId(user, null, { context: "presence/online" });
  } catch (err) {
    if (!(err instanceof ActiveOrgError)) throw err;
    orgId = null;
  }

  // No org → nothing to scope by. Return empty rather than leaking
  // every online user across the system.
  if (!orgId) {
    return NextResponse.json({
      ok: true,
      viewerId,
      count: 0,
      users: [],
    });
  }

  // LEFT JOIN through `clients` so we can surface a WhatsApp button
  // when a user has been linked to a client record (the existing
  // "link client" flow stores the user's mobile on
  // `clients.contactPhone`). Users without a linked client get
  // `phone = NULL` and the UI suppresses the WhatsApp button.
  //
  // The DISTINCT-via-MAX collapses the (theoretically possible) case
  // of one user being linked to multiple client rows; we just take
  // the first non-null phone we find. In practice each user is linked
  // to at most one client, but this keeps the row count = user count
  // even if that invariant ever drifts.
  const rows = (await db.execute<OnlineRow>(sql`
    SELECT u.id,
           u.name,
           u.email,
           u.user_type,
           p.last_seen_at,
           p.resource_key,
           (
             SELECT c.contact_phone
             FROM clients c
             WHERE c.user_id = u.id AND c.contact_phone IS NOT NULL
             ORDER BY c.id ASC
             LIMIT 1
           ) AS phone
    FROM user_presence p
    INNER JOIN users u ON u.id = p.user_id
    WHERE p.organisation_id = ${orgId}
      AND p.last_seen_at > now() - (${STALE_AFTER_SECONDS} || ' seconds')::interval
      AND u.is_active = true
    ORDER BY (p.user_id = ${viewerId}) DESC, p.last_seen_at DESC
    LIMIT 50
  `)) as unknown as OnlineRow[];

  const users = (Array.isArray(rows) ? rows : []).map((r) => ({
    id: Number(r.id),
    name: r.name,
    email: r.email,
    userType: r.user_type,
    lastSeenAt: r.last_seen_at,
    resourceKey: r.resource_key,
    phone: r.phone,
    isSelf: Number(r.id) === viewerId,
  }));

  // Count EXCLUDES the viewer so the widget can show "3 others online"
  // without an awkward "(including you)" caveat.
  const count = users.filter((u) => !u.isSelf).length;

  return NextResponse.json({ ok: true, viewerId, count, users });
});
