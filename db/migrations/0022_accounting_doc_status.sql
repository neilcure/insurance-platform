ALTER TABLE "accounting_invoices"
ADD COLUMN IF NOT EXISTS "document_status" jsonb;
