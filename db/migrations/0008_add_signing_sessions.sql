-- Add the `signing_sessions` table used by the online-signing flow.
--
-- Each row represents one outbound document email that included a
-- "Sign Online" link in its body. The recipient opens
-- `/sign/<token>` (no login — token IS the credential), draws /
-- types / accepts a signature, and we write back the signed PDF
-- pointer + signature payload here.
--
-- See `lib/signing-sessions.ts` and `db/schema/signing.ts` for the
-- TypeScript layer that drives this table.
--
-- Design notes:
--   * `token` is a 32-char hex (`crypto.randomUUID()` minus dashes
--     = 122 bits of entropy). VARCHAR(64) gives headroom for any
--     future token format change.
--   * `unsigned_pdf_stored_name` / `signed_pdf_stored_name`
--     reference rows in `pdf_template_files` (the bytea-backed
--     generic file store). We don't add a real FK because that
--     table holds many unrelated PDFs and we want signing-session
--     deletes to be lazy (cleanup job, not cascade).
--   * `expires_at` is enforced in the API layer (`isSessionOpenable`)
--     not via a CHECK constraint, so we can override on a per-row
--     basis later if needed.
--   * `policy_id` cascades on delete so removing a policy also
--     wipes any pending signing sessions tied to it.
--   * `sender_user_id` falls back to NULL on user delete so we
--     keep the audit trail even if the sender's account is removed.

CREATE TABLE IF NOT EXISTS "signing_sessions" (
  "id" serial PRIMARY KEY NOT NULL,
  "token" varchar(64) NOT NULL,
  "policy_id" integer NOT NULL,
  "tracking_key" varchar(128) NOT NULL,
  "document_label" text NOT NULL,
  "subject" text NOT NULL,
  "recipient_email" varchar(255) NOT NULL,
  "recipient_name" text,
  "sender_user_id" integer,
  "document_html" text NOT NULL,
  "unsigned_pdf_stored_name" varchar(512) NOT NULL,
  "signed_pdf_stored_name" varchar(512),
  "signature_method" varchar(16),
  "signature_data" jsonb,
  "expires_at" timestamp NOT NULL,
  "signed_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "signing_sessions_token_unique" UNIQUE ("token")
);

ALTER TABLE "signing_sessions"
  ADD CONSTRAINT "signing_sessions_policy_id_policies_id_fk"
  FOREIGN KEY ("policy_id") REFERENCES "policies" ("id") ON DELETE cascade;

ALTER TABLE "signing_sessions"
  ADD CONSTRAINT "signing_sessions_sender_user_id_users_id_fk"
  FOREIGN KEY ("sender_user_id") REFERENCES "users" ("id") ON DELETE set null;

CREATE INDEX IF NOT EXISTS "signing_sessions_token_idx"
  ON "signing_sessions" USING btree ("token");

CREATE INDEX IF NOT EXISTS "signing_sessions_policy_id_idx"
  ON "signing_sessions" USING btree ("policy_id");
