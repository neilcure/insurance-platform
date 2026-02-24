ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "policies" ADD COLUMN IF NOT EXISTS "created_by" integer;

