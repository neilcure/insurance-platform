-- Add credit note support to accounting_invoices
-- New columns: cancellation_date, refund_reason
-- Add FK constraint for parent_invoice_id

ALTER TABLE "accounting_invoices"
  ADD COLUMN IF NOT EXISTS "cancellation_date" date,
  ADD COLUMN IF NOT EXISTS "refund_reason" text;

-- Add FK for parent_invoice_id if not already constrained
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'accounting_invoices_parent_invoice_id_fkey'
      AND table_name = 'accounting_invoices'
  ) THEN
    ALTER TABLE "accounting_invoices"
      ADD CONSTRAINT "accounting_invoices_parent_invoice_id_fkey"
      FOREIGN KEY ("parent_invoice_id") REFERENCES "accounting_invoices"("id")
      ON DELETE SET NULL;
  END IF;
END $$;
