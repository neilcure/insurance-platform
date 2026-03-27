-- Ensure form_options uniqueness even if the table existed before 0003_form_options.sql ran.
-- 1) Dedupe existing rows by (group_key, value) keeping the newest active row.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY "group_key", "value"
      ORDER BY "is_active" DESC, "created_at" DESC, "id" DESC
    ) AS rn
  FROM "form_options"
)
DELETE FROM "form_options" f
USING ranked r
WHERE f."id" = r."id" AND r."rn" > 1;

-- 2) Add the UNIQUE constraint if it doesn't exist.
DO $$
BEGIN
  ALTER TABLE "form_options"
    ADD CONSTRAINT "form_options_group_value_unique" UNIQUE ("group_key", "value");
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

-- 3) Ensure index exists (harmless if already present).
CREATE INDEX IF NOT EXISTS "form_options_group_key_idx" ON "form_options" ("group_key");

