-- Denormalized `start_date_indexed` / `end_date_indexed` columns on
-- `policies` so the Policy Calendar widget can filter by date in SQL
-- instead of pulling every active policy and filtering in JS.
--
-- The source of truth remains `cars.extra_attributes ->
-- packagesSnapshot -> policy -> values -> startDate / endDate` (and
-- its fallback chain). These columns are a read-optimization populated
-- on every write to `cars.extra_attributes` and backfilled by
-- `scripts/backfill-policy-indexed-dates.ts`.
--
-- Why not an expression index on the JSON path?
--   Dates in the snapshot are stored as strings in EITHER
--   `YYYY-MM-DD` (HTML5 date input) OR `DD-MM-YYYY` (formula-evaluated
--   import). A single `to_date(...)` expression can only parse one
--   format; trying to handle both at SQL level requires unsafe
--   COALESCE chains. Materialising a normalised `date` column at
--   write time is simpler, safer, and produces a proper btree-friendly
--   value Postgres can range-scan.

ALTER TABLE "policies"
  ADD COLUMN IF NOT EXISTS "start_date_indexed" date,
  ADD COLUMN IF NOT EXISTS "end_date_indexed"   date;

-- Partial indexes: only active policies are ever queried by the
-- calendar widget, and the active-only predicate keeps the index
-- small (it ignores soft-deleted / archived rows).
CREATE INDEX IF NOT EXISTS "policies_end_date_idx"
  ON "policies" ("end_date_indexed")
  WHERE "is_active" = true;

CREATE INDEX IF NOT EXISTS "policies_start_date_idx"
  ON "policies" ("start_date_indexed")
  WHERE "is_active" = true;
