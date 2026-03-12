CREATE TABLE IF NOT EXISTS "policy_documents" (
  "id" serial PRIMARY KEY NOT NULL,
  "policy_id" integer NOT NULL REFERENCES "policies"("id") ON DELETE CASCADE,
  "document_type_key" varchar(128) NOT NULL,
  "file_name" text NOT NULL,
  "stored_path" text NOT NULL,
  "file_size" integer,
  "mime_type" varchar(128),
  "status" varchar(32) NOT NULL DEFAULT 'uploaded',
  "uploaded_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "uploaded_by_role" varchar(32) NOT NULL,
  "verified_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "verified_at" timestamp,
  "rejection_note" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "policy_documents_policy_id_idx" ON "policy_documents" ("policy_id");
CREATE INDEX IF NOT EXISTS "policy_documents_status_idx" ON "policy_documents" ("status");
