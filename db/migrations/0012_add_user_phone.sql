DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name = 'phone'
  ) THEN
    ALTER TABLE "users" RENAME COLUMN "phone" TO "mobile";
  ELSE
    ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "mobile" text;
  END IF;
END
$$;
