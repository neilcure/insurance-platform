-- Add is_active to users with a safe default (existing users stay active)
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_active" boolean NOT NULL DEFAULT true;

-- Create user_invites table
CREATE TABLE IF NOT EXISTS "user_invites" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "token_hash" varchar(256) NOT NULL UNIQUE,
  "expires_at" timestamp NOT NULL,
  "used_at" timestamp NULL,
  "created_at" timestamp NOT NULL DEFAULT now()
);

-- Create password_resets table (for future use)
CREATE TABLE IF NOT EXISTS "password_resets" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "token_hash" varchar(256) NOT NULL UNIQUE,
  "expires_at" timestamp NOT NULL,
  "used_at" timestamp NULL,
  "created_at" timestamp NOT NULL DEFAULT now()
);




















