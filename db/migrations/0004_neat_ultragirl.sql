-- Migration adjusted to be idempotent and limited to new organisation columns
ALTER TABLE "organisations" ADD COLUMN IF NOT EXISTS "contact_name" text;
ALTER TABLE "organisations" ADD COLUMN IF NOT EXISTS "contact_email" text;
ALTER TABLE "organisations" ADD COLUMN IF NOT EXISTS "contact_phone" text;
ALTER TABLE "organisations" ADD COLUMN IF NOT EXISTS "flat_number" text;
ALTER TABLE "organisations" ADD COLUMN IF NOT EXISTS "floor_number" text;
ALTER TABLE "organisations" ADD COLUMN IF NOT EXISTS "block_number" text;
ALTER TABLE "organisations" ADD COLUMN IF NOT EXISTS "block_name" text;
ALTER TABLE "organisations" ADD COLUMN IF NOT EXISTS "street_number" text;
ALTER TABLE "organisations" ADD COLUMN IF NOT EXISTS "street_name" text;
ALTER TABLE "organisations" ADD COLUMN IF NOT EXISTS "property_name" text;
ALTER TABLE "organisations" ADD COLUMN IF NOT EXISTS "district_name" text;
ALTER TABLE "organisations" ADD COLUMN IF NOT EXISTS "area" text;