-- Add org_id to user_counters and update primary key to (org_id, user_type)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_name = 'user_counters' AND column_name = 'org_id'
  ) THEN
    ALTER TABLE "user_counters" ADD COLUMN "org_id" integer NOT NULL DEFAULT 0;
  END IF;
END $$;

DO $$
BEGIN
  -- Drop old PK if it exists and recreate
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'user_counters' AND constraint_name = 'user_counters_pk'
  ) THEN
    ALTER TABLE "user_counters" DROP CONSTRAINT "user_counters_pk";
  END IF;
  ALTER TABLE "user_counters" ADD CONSTRAINT "user_counters_pk" PRIMARY KEY ("org_id", "user_type");
END $$;

