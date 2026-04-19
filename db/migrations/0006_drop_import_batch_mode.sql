-- Drop the import_batches.mode column + import_batch_mode enum.
-- Safe to run whether or not 0005 was applied as the original (with mode)
-- or as the updated (no mode) version — every step is idempotent.

ALTER TABLE IF EXISTS "import_batches" DROP COLUMN IF EXISTS "mode";

DROP TYPE IF EXISTS "import_batch_mode";
