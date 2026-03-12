CREATE TABLE IF NOT EXISTS "reminder_schedules" (
  "id" serial PRIMARY KEY NOT NULL,
  "policy_id" integer NOT NULL REFERENCES "policies"("id") ON DELETE CASCADE,
  "document_type_key" varchar(128) NOT NULL,
  "channel" varchar(32) NOT NULL DEFAULT 'email',
  "recipient_email" text NOT NULL,
  "interval_days" integer NOT NULL DEFAULT 3,
  "max_sends" integer,
  "custom_message" text,
  "is_active" boolean NOT NULL DEFAULT true,
  "completed_at" timestamp,
  "completed_reason" varchar(64),
  "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp
);

CREATE TABLE IF NOT EXISTS "reminder_send_log" (
  "id" serial PRIMARY KEY NOT NULL,
  "schedule_id" integer NOT NULL REFERENCES "reminder_schedules"("id") ON DELETE CASCADE,
  "channel" varchar(32) NOT NULL,
  "recipient_email" text NOT NULL,
  "status" varchar(32) NOT NULL DEFAULT 'sent',
  "error_message" text,
  "sent_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "reminder_schedules_policy_id_idx" ON "reminder_schedules" ("policy_id");
CREATE INDEX IF NOT EXISTS "reminder_schedules_active_idx" ON "reminder_schedules" ("is_active") WHERE "is_active" = true;
CREATE INDEX IF NOT EXISTS "reminder_send_log_schedule_id_idx" ON "reminder_send_log" ("schedule_id");
