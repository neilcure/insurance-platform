-- Add insurer_policy_id column to policy_premiums.
-- Insurance companies are stored as policies in a flow (like collaborators),
-- so we reference policies(id) instead of organisations(id).
ALTER TABLE "policy_premiums"
  ADD COLUMN IF NOT EXISTS "insurer_policy_id" integer REFERENCES "policies"("id") ON DELETE SET NULL;
