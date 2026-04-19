-- Bulk-import staging area
-- Two new tables (import_batches + import_batch_rows) plus three enums.
-- Purely additive — no existing tables are touched.

DO $$ BEGIN
  CREATE TYPE "import_batch_status" AS ENUM ('parsing', 'review', 'committing', 'committed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "import_batch_row_status" AS ENUM ('pending', 'skipped', 'committed', 'failed');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "import_batches" (
  "id" serial PRIMARY KEY,
  "flow_key" varchar(64) NOT NULL,
  "client_flow_key" varchar(64) NOT NULL DEFAULT 'clientSet',
  "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "filename" text,
  "file_size_bytes" integer,
  "status" "import_batch_status" NOT NULL DEFAULT 'parsing',
  "total_rows" integer NOT NULL DEFAULT 0,
  "ready_rows" integer NOT NULL DEFAULT 0,
  "warning_rows" integer NOT NULL DEFAULT 0,
  "error_rows" integer NOT NULL DEFAULT 0,
  "committed_rows" integer NOT NULL DEFAULT 0,
  "failed_rows" integer NOT NULL DEFAULT 0,
  "skipped_rows" integer NOT NULL DEFAULT 0,
  "summary" jsonb DEFAULT '{}'::jsonb,
  "last_error" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "committing_started_at" timestamp,
  "committed_at" timestamp
);

CREATE INDEX IF NOT EXISTS "import_batches_flow_idx" ON "import_batches" ("flow_key");
CREATE INDEX IF NOT EXISTS "import_batches_status_idx" ON "import_batches" ("status");
CREATE INDEX IF NOT EXISTS "import_batches_creator_idx" ON "import_batches" ("created_by");
CREATE INDEX IF NOT EXISTS "import_batches_created_at_idx" ON "import_batches" ("created_at");

CREATE TABLE IF NOT EXISTS "import_batch_rows" (
  "id" serial PRIMARY KEY,
  "batch_id" integer NOT NULL REFERENCES "import_batches"("id") ON DELETE CASCADE,
  "excel_row" integer NOT NULL,
  "raw_values" jsonb NOT NULL,
  "status" "import_batch_row_status" NOT NULL DEFAULT 'pending',
  "errors" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "warnings" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "edited" boolean NOT NULL DEFAULT false,
  "commit_attempts" integer NOT NULL DEFAULT 0,
  "last_commit_error" text,
  "created_policy_id" integer,
  "created_policy_number" text,
  "resolved_client_number" text,
  "client_created" boolean NOT NULL DEFAULT false,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "committed_at" timestamp
);

CREATE INDEX IF NOT EXISTS "import_batch_rows_batch_idx" ON "import_batch_rows" ("batch_id");
CREATE INDEX IF NOT EXISTS "import_batch_rows_batch_status_idx" ON "import_batch_rows" ("batch_id", "status");
CREATE INDEX IF NOT EXISTS "import_batch_rows_batch_excel_row_idx" ON "import_batch_rows" ("batch_id", "excel_row");
