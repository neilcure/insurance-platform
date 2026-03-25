-- Add additional structured columns to policy_premiums for complete accounting support

ALTER TABLE policy_premiums ADD COLUMN IF NOT EXISTS credit_premium_cents integer;
ALTER TABLE policy_premiums ADD COLUMN IF NOT EXISTS levy_cents integer;
ALTER TABLE policy_premiums ADD COLUMN IF NOT EXISTS stamp_duty_cents integer;
ALTER TABLE policy_premiums ADD COLUMN IF NOT EXISTS discount_cents integer;
