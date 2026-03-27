-- Add updated_at columns for users and organisations to surface last account update time
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "updated_at" timestamp NULL;
ALTER TABLE "organisations" ADD COLUMN IF NOT EXISTS "updated_at" timestamp NULL;

