-- Accounting: payment schedules, invoices, payments, documents

CREATE TABLE IF NOT EXISTS "accounting_payment_schedules" (
  "id" serial PRIMARY KEY,
  "organisation_id" integer NOT NULL REFERENCES "organisations"("id") ON DELETE CASCADE,
  "entity_policy_id" integer REFERENCES "policies"("id") ON DELETE SET NULL,
  "entity_type" varchar(20) NOT NULL,
  "entity_name" varchar(256),
  "frequency" varchar(20) NOT NULL DEFAULT 'monthly',
  "billing_day" integer,
  "currency" varchar(8) NOT NULL DEFAULT 'HKD',
  "is_active" boolean NOT NULL DEFAULT true,
  "notes" text,
  "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "accounting_invoices" (
  "id" serial PRIMARY KEY,
  "organisation_id" integer NOT NULL REFERENCES "organisations"("id") ON DELETE CASCADE,
  "invoice_number" varchar(100) NOT NULL,
  "invoice_type" varchar(30) NOT NULL,
  "direction" varchar(20) NOT NULL,
  "premium_type" varchar(30) NOT NULL,
  "entity_policy_id" integer REFERENCES "policies"("id") ON DELETE SET NULL,
  "entity_type" varchar(20) NOT NULL,
  "entity_name" varchar(256),
  "schedule_id" integer REFERENCES "accounting_payment_schedules"("id") ON DELETE SET NULL,
  "parent_invoice_id" integer REFERENCES "accounting_invoices"("id") ON DELETE SET NULL,
  "total_amount_cents" integer NOT NULL DEFAULT 0,
  "paid_amount_cents" integer NOT NULL DEFAULT 0,
  "currency" varchar(8) NOT NULL DEFAULT 'HKD',
  "invoice_date" date,
  "due_date" date,
  "period_start" date,
  "period_end" date,
  "status" varchar(20) NOT NULL DEFAULT 'draft',
  "notes" text,
  "verified_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "verified_at" timestamp,
  "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "accounting_invoices_org_idx" ON "accounting_invoices" ("organisation_id");
CREATE INDEX IF NOT EXISTS "accounting_invoices_status_idx" ON "accounting_invoices" ("status");
CREATE INDEX IF NOT EXISTS "accounting_invoices_entity_idx" ON "accounting_invoices" ("entity_type", "entity_policy_id");
CREATE INDEX IF NOT EXISTS "accounting_invoices_parent_idx" ON "accounting_invoices" ("parent_invoice_id");

CREATE TABLE IF NOT EXISTS "accounting_invoice_items" (
  "id" serial PRIMARY KEY,
  "invoice_id" integer NOT NULL REFERENCES "accounting_invoices"("id") ON DELETE CASCADE,
  "policy_id" integer NOT NULL REFERENCES "policies"("id") ON DELETE CASCADE,
  "policy_premium_id" integer,
  "line_key" varchar(64),
  "amount_cents" integer NOT NULL,
  "description" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "accounting_invoice_items_invoice_idx" ON "accounting_invoice_items" ("invoice_id");
CREATE INDEX IF NOT EXISTS "accounting_invoice_items_policy_idx" ON "accounting_invoice_items" ("policy_id");

CREATE TABLE IF NOT EXISTS "accounting_payments" (
  "id" serial PRIMARY KEY,
  "invoice_id" integer NOT NULL REFERENCES "accounting_invoices"("id") ON DELETE CASCADE,
  "amount_cents" integer NOT NULL,
  "currency" varchar(8) NOT NULL DEFAULT 'HKD',
  "payment_date" date,
  "payment_method" varchar(50),
  "reference_number" varchar(100),
  "status" varchar(20) NOT NULL DEFAULT 'recorded',
  "notes" text,
  "submitted_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "verified_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "verified_at" timestamp,
  "rejection_note" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "accounting_payments_invoice_idx" ON "accounting_payments" ("invoice_id");
CREATE INDEX IF NOT EXISTS "accounting_payments_status_idx" ON "accounting_payments" ("status");

CREATE TABLE IF NOT EXISTS "accounting_documents" (
  "id" serial PRIMARY KEY,
  "invoice_id" integer REFERENCES "accounting_invoices"("id") ON DELETE CASCADE,
  "payment_id" integer REFERENCES "accounting_payments"("id") ON DELETE CASCADE,
  "doc_type" varchar(30) NOT NULL,
  "file_name" varchar(255) NOT NULL,
  "stored_path" varchar(500) NOT NULL,
  "file_size" integer,
  "mime_type" varchar(128),
  "uploaded_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "accounting_documents_invoice_idx" ON "accounting_documents" ("invoice_id");
CREATE INDEX IF NOT EXISTS "accounting_documents_payment_idx" ON "accounting_documents" ("payment_id");
