CREATE TABLE IF NOT EXISTS "announcements" (
  "id" serial PRIMARY KEY NOT NULL,
  "organisation_id" integer NOT NULL REFERENCES "organisations"("id") ON DELETE CASCADE,
  "title" text NOT NULL,
  "body_html" text NOT NULL DEFAULT '',
  "media_kind" text NOT NULL DEFAULT 'none',
  "media_stored_name" text,
  "link_url" text,
  "starts_at" timestamp NOT NULL,
  "ends_at" timestamp NOT NULL,
  "auto_close_seconds" integer,
  "is_active" boolean NOT NULL DEFAULT true,
  "priority" integer NOT NULL DEFAULT 0,
  "targeting" jsonb NOT NULL DEFAULT '{"mode":"all"}'::jsonb,
  "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp
);

CREATE INDEX IF NOT EXISTS "announcements_org_idx" ON "announcements" ("organisation_id");

CREATE TABLE IF NOT EXISTS "announcement_dismissals" (
  "announcement_id" integer NOT NULL REFERENCES "announcements"("id") ON DELETE CASCADE,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "dismissed_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "announcement_dismissals_pk" PRIMARY KEY ("announcement_id", "user_id")
);
