ALTER TABLE "users"
ADD COLUMN IF NOT EXISTS "profile_meta" jsonb DEFAULT 'null'::jsonb;
