-- Rename enum value insurer_staff -> internal_staff (if exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'user_type' AND e.enumlabel = 'insurer_staff'
  ) THEN
    ALTER TYPE "user_type" RENAME VALUE 'insurer_staff' TO 'internal_staff';
  END IF;
END $$;

-- Add accounting if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'user_type' AND e.enumlabel = 'accounting'
  ) THEN
    ALTER TYPE "user_type" ADD VALUE 'accounting';
  END IF;
END $$;

