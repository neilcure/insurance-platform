ALTER TABLE "policies" ADD COLUMN "flow_key" text;--> statement-breakpoint
CREATE INDEX "policies_flow_key_idx" ON "policies" USING btree ("flow_key");--> statement-breakpoint
UPDATE "policies" p
SET "flow_key" = (
  SELECT c.extra_attributes::jsonb ->> 'flowKey'
  FROM "cars" c
  WHERE c.policy_id = p.id
  LIMIT 1
)
WHERE p."flow_key" IS NULL;
