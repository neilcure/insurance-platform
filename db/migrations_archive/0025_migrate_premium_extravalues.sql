-- One-time migration: Move premium data from extraValues JSONB into structured columns.
-- This fixes the dual-storage problem where admin field keys like 'agentPremium'
-- wrote to extraValues instead of the agentCommissionCents column.

-- Agent premium / agent commission → agent_commission_cents
UPDATE policy_premiums
SET agent_commission_cents = ROUND((extra_values->>'agentPremium')::numeric * 100)::int
WHERE (agent_commission_cents IS NULL OR agent_commission_cents = 0)
  AND extra_values->>'agentPremium' IS NOT NULL
  AND (extra_values->>'agentPremium')::numeric > 0;

UPDATE policy_premiums
SET agent_commission_cents = ROUND((extra_values->>'apremium')::numeric * 100)::int
WHERE (agent_commission_cents IS NULL OR agent_commission_cents = 0)
  AND extra_values->>'apremium' IS NOT NULL
  AND (extra_values->>'apremium')::numeric > 0;

UPDATE policy_premiums
SET agent_commission_cents = ROUND((extra_values->>'agent_premium')::numeric * 100)::int
WHERE (agent_commission_cents IS NULL OR agent_commission_cents = 0)
  AND extra_values->>'agent_premium' IS NOT NULL
  AND (extra_values->>'agent_premium')::numeric > 0;

-- Client premium → client_premium_cents
UPDATE policy_premiums
SET client_premium_cents = ROUND((extra_values->>'clientPremium')::numeric * 100)::int
WHERE (client_premium_cents IS NULL OR client_premium_cents = 0)
  AND extra_values->>'clientPremium' IS NOT NULL
  AND (extra_values->>'clientPremium')::numeric > 0;

UPDATE policy_premiums
SET client_premium_cents = ROUND((extra_values->>'cpremium')::numeric * 100)::int
WHERE (client_premium_cents IS NULL OR client_premium_cents = 0)
  AND extra_values->>'cpremium' IS NOT NULL
  AND (extra_values->>'cpremium')::numeric > 0;

-- Net premium → net_premium_cents
UPDATE policy_premiums
SET net_premium_cents = ROUND((extra_values->>'netPremium')::numeric * 100)::int
WHERE (net_premium_cents IS NULL OR net_premium_cents = 0)
  AND extra_values->>'netPremium' IS NOT NULL
  AND (extra_values->>'netPremium')::numeric > 0;

UPDATE policy_premiums
SET net_premium_cents = ROUND((extra_values->>'npremium')::numeric * 100)::int
WHERE (net_premium_cents IS NULL OR net_premium_cents = 0)
  AND extra_values->>'npremium' IS NOT NULL
  AND (extra_values->>'npremium')::numeric > 0;

-- Gross premium → gross_premium_cents
UPDATE policy_premiums
SET gross_premium_cents = ROUND((extra_values->>'grossPremium')::numeric * 100)::int
WHERE (gross_premium_cents IS NULL OR gross_premium_cents = 0)
  AND extra_values->>'grossPremium' IS NOT NULL
  AND (extra_values->>'grossPremium')::numeric > 0;

UPDATE policy_premiums
SET gross_premium_cents = ROUND((extra_values->>'gpremium')::numeric * 100)::int
WHERE (gross_premium_cents IS NULL OR gross_premium_cents = 0)
  AND extra_values->>'gpremium' IS NOT NULL
  AND (extra_values->>'gpremium')::numeric > 0;
