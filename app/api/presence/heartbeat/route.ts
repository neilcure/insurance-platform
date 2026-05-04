/**
 * POST /api/presence/heartbeat
 *
 * Stamps the caller's `user_presence.last_seen_at` to NOW(). Called by
 * the dashboard's `usePresenceHeartbeat` hook every ~30 seconds while
 * the tab is visible. The widget query then treats anyone with
 * `last_seen_at > now() - 60s` as "online".
 *
 * Body (all optional):
 *   { "resourceKey": string | null }   // Phase B — what the user is
 *                                       // currently editing/viewing
 *
 * Returns:
 *   { ok: true, lastSeenAt: ISO string }
 *
 * Why one row per user
 * --------------------
 * `user_presence.user_id` is the PK so this is a constant-time UPSERT
 * (no row growth). At our heartbeat cadence (2/min/user) this scales
 * to thousands of concurrent users on a single Postgres connection
 * without bloating the table.
 *
 * Why we stamp `organisation_id` here
 * -----------------------------------
 * The "online users" widget needs to filter by viewer's active org.
 * Stamping the JWT-resolved active org on every heartbeat means a
 * single indexed lookup `WHERE organisation_id = $1 AND last_seen_at > $2`
 * answers the question, instead of joining through `memberships` on
 * every read.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { withAuth } from "@/lib/auth/with-auth";
import { resolveActiveOrgId, ActiveOrgError } from "@/lib/auth/active-org";

const Body = z
  .object({
    resourceKey: z.string().max(128).nullable().optional(),
  })
  .partial();

export const POST = withAuth(async (request, { user }) => {
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    // Body is optional — clients can heartbeat with no body.
  }

  const parsed = Body.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body" },
      { status: 400 },
    );
  }
  const resourceKey = parsed.data.resourceKey ?? null;

  // Resolve active org (warn-only by default — see docs/multi-tenancy.md).
  // We tolerate "no org resolvable" so admins without a membership still
  // get a heartbeat row (organisation_id stays NULL and they're invisible
  // to org-scoped widgets, which is the intended privacy default).
  let orgId: number | null = null;
  try {
    orgId = await resolveActiveOrgId(user, null, { context: "presence/heartbeat" });
  } catch (err) {
    if (!(err instanceof ActiveOrgError)) throw err;
    orgId = null;
  }

  const userId = Number(user.id);
  if (!Number.isFinite(userId) || userId <= 0) {
    return NextResponse.json({ error: "Invalid session user" }, { status: 401 });
  }

  // Single-statement upsert. Postgres `now()` is evaluated server-side
  // so all rows share a consistent clock regardless of client skew.
  const rows = await db.execute<{ last_seen_at: string }>(sql`
    INSERT INTO user_presence (user_id, organisation_id, resource_key, last_seen_at)
    VALUES (${userId}, ${orgId}, ${resourceKey}, now())
    ON CONFLICT (user_id) DO UPDATE
      SET organisation_id = EXCLUDED.organisation_id,
          resource_key    = EXCLUDED.resource_key,
          last_seen_at    = now()
    RETURNING last_seen_at
  `);

  // drizzle's `db.execute` returns either an array or a wrapper —
  // postgres-js returns the array directly so this works for both.
  const lastSeenAt =
    Array.isArray(rows) && rows[0]?.last_seen_at
      ? rows[0].last_seen_at
      : new Date().toISOString();

  return NextResponse.json({ ok: true, lastSeenAt });
});
