-- Add optional user_number to users
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "user_number" text;

-- Create user_counters table for per-type numbering
CREATE TABLE IF NOT EXISTS "user_counters" (
  "user_type" "user_type" NOT NULL,
  "last_number" integer NOT NULL DEFAULT 0,
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "user_counters_pk" PRIMARY KEY ("user_type")
);

