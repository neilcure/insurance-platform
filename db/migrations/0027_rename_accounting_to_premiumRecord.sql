-- Rename package key from "accounting" to "premiumRecord"

-- 1. Update the package entry itself
UPDATE form_options
SET value = 'premiumRecord'
WHERE group_key = 'packages' AND value = 'accounting';

-- 2. Rename field groupKey
UPDATE form_options
SET group_key = 'premiumRecord_fields'
WHERE group_key = 'accounting_fields';

-- 3. Rename category groupKey
UPDATE form_options
SET group_key = 'premiumRecord_category'
WHERE group_key = 'accounting_category';
