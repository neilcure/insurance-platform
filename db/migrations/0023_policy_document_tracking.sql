ALTER TABLE "policies"
ADD COLUMN IF NOT EXISTS "document_tracking" jsonb;
