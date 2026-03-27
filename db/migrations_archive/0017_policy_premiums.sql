CREATE TABLE IF NOT EXISTS "policy_premiums" (
  "id" serial PRIMARY KEY NOT NULL,
  "policy_id" integer NOT NULL REFERENCES "policies"("id") ON DELETE CASCADE,
  "line_key" varchar(64) NOT NULL DEFAULT 'main',
  "line_label" varchar(128),
  "currency" varchar(8) NOT NULL DEFAULT 'HKD',
  "gross_premium_cents" integer,
  "net_premium_cents" integer,
  "client_premium_cents" integer,
  "agent_commission_cents" integer,
  "commission_rate" numeric(6, 2),
  "extra_values" jsonb DEFAULT null,
  "note" text,
  "updated_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "policy_premiums_policy_line_unique" ON "policy_premiums" ("policy_id", "line_key");
CREATE INDEX IF NOT EXISTS "policy_premiums_updated_at_idx" ON "policy_premiums" ("updated_at");
