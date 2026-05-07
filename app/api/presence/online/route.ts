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
import { pgTimestampToIsoUtc } from "@/lib/format/date";

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

  // Resolve the user's WhatsApp phone from the data source users see
  // in the app:
  //
  // 1. Prefer the latest client-flow / policy snapshot mobile, because
  //    users can edit contactinfo__mobile after the linked `clients`
  //    row was created. That live snapshot is where values like
  //    `63433816` usually live.
  // 2. Fall back to clients.contact_phone (the denormalised value
  //    created by the "link client" flow).
  //
  // Users without a linked client/snapshot get phone = NULL and the UI
  // suppresses the WhatsApp button.
  const rows = (await db.execute<OnlineRow>(sql`
    SELECT u.id,
           u.name,
           u.email,
           u.user_type,
           p.last_seen_at,
           p.resource_key,
           COALESCE(
             (
               SELECT COALESCE(
                 car.extra_attributes #>> '{insuredSnapshot,contactinfo__mobile}',
                 car.extra_attributes #>> '{insuredSnapshot,contactinfo_mobile}',
                 car.extra_attributes #>> '{packagesSnapshot,contactinfo,values,contactinfo__mobile}',
                 car.extra_attributes #>> '{packagesSnapshot,contactinfo,values,contactinfo_mobile}',
                 car.extra_attributes #>> '{insuredSnapshot,mobile}',
                 car.extra_attributes #>> '{insuredSnapshot,tel}',
                 car.extra_attributes #>> '{packagesSnapshot,contactinfo,values,mobile}',
                 car.extra_attributes #>> '{packagesSnapshot,contactinfo,values,tel}'
               )
               FROM clients c
               INNER JOIN cars car
                 ON (
                   COALESCE(
                     car.extra_attributes #>> '{insuredSnapshot,clientPolicyId}',
                     car.extra_attributes #>> '{clientPolicyId}'
                   ) = c.client_number
                   OR COALESCE(
                     car.extra_attributes #>> '{insuredSnapshot,clientPolicyId}',
                     car.extra_attributes #>> '{clientPolicyId}'
                   ) = c.id::text
                   OR lower(COALESCE(
                     car.extra_attributes #>> '{insuredSnapshot,insured__idNumber}',
                     car.extra_attributes #>> '{insuredSnapshot,insured__idnumber}',
                     car.extra_attributes #>> '{insuredSnapshot,idNumber}',
                     car.extra_attributes #>> '{insuredSnapshot,idnumber}',
                     car.extra_attributes #>> '{insuredSnapshot,insured__brNumber}',
                     car.extra_attributes #>> '{insuredSnapshot,insured__brnumber}',
                     ''
                   )) = lower(COALESCE(c.primary_id, ''))
                 )
               WHERE c.user_id = u.id
               ORDER BY car.id DESC
               LIMIT 1
             ),
             (
               SELECT COALESCE(
                 c.extra_attributes #>> '{contactinfo__mobile}',
                 c.extra_attributes #>> '{contactinfo_mobile}',
                 c.extra_attributes #>> '{mobile}',
                 c.extra_attributes #>> '{contactinfo__tel}',
                 c.extra_attributes #>> '{contactinfo_tel}',
                 c.extra_attributes #>> '{tel}',
                 c.contact_phone
               )
               FROM clients c
               WHERE c.user_id = u.id
               ORDER BY c.id ASC
               LIMIT 1
             )
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
    // Normalise the postgres `timestamp` (no tz) value into an ISO-UTC
    // string ending in `Z`. Without this the client's `timeAgo()` would
    // treat the timestamp as local time and display a constant N-hour
    // offset (e.g. "8h ago" for every just-heartbeated HK user).
    lastSeenAt: pgTimestampToIsoUtc(r.last_seen_at),
    resourceKey: r.resource_key,
    phone: r.phone,
    isSelf: Number(r.id) === viewerId,
  }));

  // Count EXCLUDES the viewer so the widget can show "3 others online"
  // without an awkward "(including you)" caveat.
  const count = users.filter((u) => !u.isSelf).length;

  return NextResponse.json({ ok: true, viewerId, count, users });
});
