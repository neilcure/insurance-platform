-- Remove leftover coverTypes from Policies flow meta (no longer used)
UPDATE form_options
SET meta = meta - 'coverTypes'
WHERE id = 422 AND group_key = 'flows';

-- Remove accounting_line_config from app_settings if it exists (old approach)
DELETE FROM app_settings WHERE key = 'accounting_line_config';
