-- Add a per-row resolved-references payload to import_batch_rows so the
-- staging review UI can render the company / agent NAME alongside the raw
-- record number the user typed (or imported by name).
--
-- Shape (jsonb, default empty object):
--   {
--     "<columnId>": {
--       "status": "ok" | "missing",
--       "displayName": string,
--       "recordNumber": string,
--       "kind": "agent" | "entity",
--       "rawInput": string
--     },
--     ...
--   }
--
-- Nullable + defaulted so we can add it without backfilling existing rows.

ALTER TABLE IF EXISTS "import_batch_rows"
  ADD COLUMN IF NOT EXISTS "resolved_refs" jsonb NOT NULL DEFAULT '{}'::jsonb;
