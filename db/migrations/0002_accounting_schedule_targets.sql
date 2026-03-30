ALTER TABLE "accounting_payment_schedules" ADD COLUMN "agent_id" integer;--> statement-breakpoint
ALTER TABLE "accounting_payment_schedules" ADD COLUMN "client_id" integer;--> statement-breakpoint
ALTER TABLE "accounting_payment_schedules" ADD COLUMN "last_generated_at" timestamp;--> statement-breakpoint
ALTER TABLE "accounting_payment_schedules" ADD COLUMN "last_period_start" date;--> statement-breakpoint
ALTER TABLE "accounting_payment_schedules" ADD COLUMN "last_period_end" date;--> statement-breakpoint
ALTER TABLE "accounting_payment_schedules" ADD CONSTRAINT "accounting_payment_schedules_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_payment_schedules" ADD CONSTRAINT "accounting_payment_schedules_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounting_payment_schedules_active_idx" ON "accounting_payment_schedules" USING btree ("organisation_id","is_active");--> statement-breakpoint
CREATE INDEX "accounting_payment_schedules_agent_idx" ON "accounting_payment_schedules" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "accounting_payment_schedules_client_idx" ON "accounting_payment_schedules" USING btree ("client_id");
