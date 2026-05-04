-- Add the `user_presence` table that powers the "online users" widget
-- and (Phase B) the "who's editing this policy right now" badge.
--
-- One row per user (PK = user_id), so heartbeats are a constant-time
-- UPSERT instead of an unbounded append. The widget polls
-- GET /api/presence/online which filters by:
--
--   organisation_id = <viewer's active org>
--   AND last_seen_at > now() - interval '60 seconds'
--
-- Design notes:
--   * `user_id` is the primary key (no surrogate id) so the upsert
--     in /api/presence/heartbeat is `INSERT ... ON CONFLICT (user_id)`.
--   * `organisation_id` is captured at heartbeat time from the
--     resolved active org (resolveActiveOrgId). NULL is allowed so
--     admins/internal_staff without a membership still keep a row.
--   * `resource_key` is reserved for Phase B (e.g. `policy:123`).
--     Phase A leaves it NULL; adding it now means Phase B is purely
--     a code change with no schema migration.
--   * `(organisation_id, last_seen_at)` index covers the widget query.
--   * `(resource_key)` index covers the per-policy presence query
--     used in Phase B.
--   * No CHECK constraint on `last_seen_at`: stale rows are filtered
--     in SQL at read time. A periodic VACUUM-grade cleanup job can
--     prune entries older than a few minutes if the table grows.

CREATE TABLE IF NOT EXISTS "user_presence" (
  "user_id" integer PRIMARY KEY NOT NULL,
  "organisation_id" integer,
  "resource_key" text,
  "last_seen_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "user_presence_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE cascade,
  CONSTRAINT "user_presence_organisation_id_organisations_id_fk"
    FOREIGN KEY ("organisation_id") REFERENCES "organisations" ("id") ON DELETE set null
);

CREATE INDEX IF NOT EXISTS "user_presence_org_last_seen_idx"
  ON "user_presence" USING btree ("organisation_id", "last_seen_at");

CREATE INDEX IF NOT EXISTS "user_presence_resource_idx"
  ON "user_presence" USING btree ("resource_key");
