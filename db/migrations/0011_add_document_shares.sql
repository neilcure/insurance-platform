-- Add the `document_shares` table that backs the "WhatsApp Files"
-- feature. Each row represents a token-gated public download bundle
-- the sender created so they can paste the link into a WhatsApp
-- (or any other) chat — recipients open the link in any browser
-- and download the file(s) without logging in.
--
-- Why this is the right shape:
--   * `wa.me` deep links cannot attach files (Meta limitation).
--     Sending a download link via WhatsApp is the universally-used
--     workaround in HK insurance/banking.
--   * The token IS the credential. ≥128 bits of entropy makes it
--     unguessable; the recipient gets it via WhatsApp, which is
--     end-to-end encrypted. Same security model as our existing
--     `signing_sessions` flow.
--   * `expires_at` is enforced server-side on every read so even
--     a leaked token expires automatically.
--   * `last_accessed_at` + `access_count` give the sender visibility
--     ("did the customer actually open it?") without polluting the
--     main audit table.
--   * Cascade delete on `policy_id`: removing a policy
--     instantly invalidates all pending share links for that policy.
--   * Set-null on `created_by`: deleting a user shouldn't break
--     a recipient's pending download.
--
-- File contents are NOT duplicated here; the row only stores
-- references (`document_ids`, `pdf_template_ids`). On download we
-- stream the file from the existing `policy_documents.stored_path`
-- or regenerate the PDF on the fly via `buildMergeContext` +
-- `generateFilledPdf` — same code path as the email flow, so the
-- recipient always gets the freshest snapshot of policy data.

CREATE TABLE IF NOT EXISTS "document_shares" (
  "id" serial PRIMARY KEY NOT NULL,
  "token" varchar(64) NOT NULL UNIQUE,
  "policy_id" integer NOT NULL,
  "document_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "pdf_template_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "flatten_pdfs" boolean DEFAULT true NOT NULL,
  "label" text,
  "message_sent" text,
  "recipient_phone" varchar(32),
  "recipient_name" text,
  "expires_at" timestamp NOT NULL,
  "created_by" integer,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "last_accessed_at" timestamp,
  "access_count" integer DEFAULT 0 NOT NULL,
  CONSTRAINT "document_shares_policy_id_fk"
    FOREIGN KEY ("policy_id") REFERENCES "policies" ("id") ON DELETE cascade,
  CONSTRAINT "document_shares_created_by_fk"
    FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE set null
);

CREATE INDEX IF NOT EXISTS "document_shares_token_idx"
  ON "document_shares" USING btree ("token");

CREATE INDEX IF NOT EXISTS "document_shares_policy_id_idx"
  ON "document_shares" USING btree ("policy_id");

CREATE INDEX IF NOT EXISTS "document_shares_expires_at_idx"
  ON "document_shares" USING btree ("expires_at");
