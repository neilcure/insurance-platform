-- Add timezone preference to users (IANA tz, e.g., Asia/Hong_Kong)
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "timezone" text NULL;

