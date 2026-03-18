-- Add per-line insurance company and collaborator associations to policy_premiums
ALTER TABLE "policy_premiums"
  ADD COLUMN IF NOT EXISTS "organisation_id" integer REFERENCES "organisations"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "collaborator_id" integer REFERENCES "policies"("id") ON DELETE SET NULL;
