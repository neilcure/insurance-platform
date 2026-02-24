-- Form option groups table
CREATE TABLE IF NOT EXISTS "form_option_groups" (
  "id" serial PRIMARY KEY,
  "key" varchar(128) NOT NULL UNIQUE,
  "label" varchar(256) NOT NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now()
);

-- Form options table
CREATE TABLE IF NOT EXISTS "form_options" (
  "id" serial PRIMARY KEY,
  "group_key" varchar(128) NOT NULL,
  "label" varchar(256) NOT NULL,
  "value" varchar(128) NOT NULL,
  "value_type" varchar(64) NOT NULL DEFAULT 'boolean',
  "sort_order" integer NOT NULL DEFAULT 0,
  "is_active" boolean NOT NULL DEFAULT true,
  "meta" jsonb,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "form_options_group_value_unique" UNIQUE ("group_key","value")
);

CREATE INDEX IF NOT EXISTS "form_options_group_key_idx" ON "form_options" ("group_key");
















