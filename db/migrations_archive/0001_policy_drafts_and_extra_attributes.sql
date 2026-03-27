ALTER TABLE "cars" ADD COLUMN "extra_attributes" jsonb;

CREATE TABLE IF NOT EXISTS "policy_drafts" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL,
  "wizard_state" jsonb NOT NULL,
  "current_step" integer NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);






















