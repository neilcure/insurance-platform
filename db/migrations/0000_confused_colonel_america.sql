CREATE TYPE "public"."user_type" AS ENUM('admin', 'agent', 'direct_client', 'service_provider', 'internal_staff', 'accounting');--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb DEFAULT 'null'::jsonb,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"user_type" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" integer,
	"changes" jsonb DEFAULT 'null'::jsonb,
	"is_read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_agent_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"agent_id" integer NOT NULL,
	"assigned_at" timestamp DEFAULT now() NOT NULL,
	"unassigned_at" timestamp,
	"assigned_by" integer
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_number" text NOT NULL,
	"category" text NOT NULL,
	"display_name" text NOT NULL,
	"primary_id" text NOT NULL,
	"contact_phone" text,
	"extra_attributes" jsonb DEFAULT 'null'::jsonb,
	"created_by" integer,
	"user_id" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "clients_client_number_unique" UNIQUE("client_number")
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"user_id" integer NOT NULL,
	"organisation_id" integer NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_pk" PRIMARY KEY("user_id","organisation_id")
);
--> statement-breakpoint
CREATE TABLE "organisations" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"contact_name" text,
	"contact_email" text,
	"contact_phone" text,
	"flat_number" text,
	"floor_number" text,
	"block_number" text,
	"block_name" text,
	"street_number" text,
	"street_name" text,
	"property_name" text,
	"district_name" text,
	"area" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "password_resets" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"token_hash" varchar(256) NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "password_resets_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "user_counters" (
	"org_id" integer DEFAULT 0 NOT NULL,
	"user_type" "user_type" NOT NULL,
	"last_number" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "user_counters_pk" PRIMARY KEY("org_id","user_type")
);
--> statement-breakpoint
CREATE TABLE "user_invites" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"token_hash" varchar(256) NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_invites_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text,
	"timezone" text,
	"user_type" "user_type" DEFAULT 'agent' NOT NULL,
	"user_number" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "cars" (
	"id" serial PRIMARY KEY NOT NULL,
	"policy_id" integer NOT NULL,
	"plate_number" text NOT NULL,
	"make" text,
	"model" text,
	"year" integer,
	"extra_attributes" jsonb DEFAULT 'null'::jsonb
);
--> statement-breakpoint
CREATE TABLE "coverages" (
	"id" serial PRIMARY KEY NOT NULL,
	"policy_id" integer NOT NULL,
	"type" text NOT NULL,
	"limit_amount_cents" integer,
	"premium_cents" integer
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"policy_id" integer NOT NULL,
	"amount_cents" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"paid_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policies" (
	"id" serial PRIMARY KEY NOT NULL,
	"policy_number" text NOT NULL,
	"organisation_id" integer NOT NULL,
	"client_id" integer,
	"agent_id" integer,
	"created_by" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"document_tracking" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "policies_policy_number_unique" UNIQUE("policy_number")
);
--> statement-breakpoint
CREATE TABLE "policy_drafts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"wizard_state" jsonb NOT NULL,
	"current_step" integer NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "form_option_groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" varchar(128) NOT NULL,
	"label" varchar(256) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "form_option_groups_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "form_options" (
	"id" serial PRIMARY KEY NOT NULL,
	"group_key" varchar(128) NOT NULL,
	"label" varchar(256) NOT NULL,
	"value" varchar(128) NOT NULL,
	"value_type" varchar(64) DEFAULT 'boolean' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"meta" jsonb DEFAULT 'null'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policy_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"policy_id" integer NOT NULL,
	"document_type_key" varchar(128) NOT NULL,
	"file_name" text NOT NULL,
	"stored_path" text NOT NULL,
	"file_size" integer,
	"mime_type" varchar(128),
	"status" varchar(32) DEFAULT 'uploaded' NOT NULL,
	"uploaded_by" integer,
	"uploaded_by_role" varchar(32) NOT NULL,
	"verified_by" integer,
	"verified_at" timestamp,
	"rejection_note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reminder_schedules" (
	"id" serial PRIMARY KEY NOT NULL,
	"policy_id" integer NOT NULL,
	"document_type_key" varchar(128) NOT NULL,
	"channel" varchar(32) DEFAULT 'email' NOT NULL,
	"recipient_email" text NOT NULL,
	"interval_days" integer DEFAULT 3 NOT NULL,
	"max_sends" integer,
	"custom_message" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"completed_at" timestamp,
	"completed_reason" varchar(64),
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "reminder_send_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"schedule_id" integer NOT NULL,
	"channel" varchar(32) NOT NULL,
	"recipient_email" text NOT NULL,
	"status" varchar(32) DEFAULT 'sent' NOT NULL,
	"error_message" text,
	"sent_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policy_premiums" (
	"id" serial PRIMARY KEY NOT NULL,
	"policy_id" integer NOT NULL,
	"line_key" varchar(64) DEFAULT 'main' NOT NULL,
	"line_label" varchar(128),
	"currency" varchar(8) DEFAULT 'HKD' NOT NULL,
	"organisation_id" integer,
	"collaborator_id" integer,
	"insurer_policy_id" integer,
	"gross_premium_cents" integer,
	"net_premium_cents" integer,
	"client_premium_cents" integer,
	"agent_commission_cents" integer,
	"credit_premium_cents" integer,
	"levy_cents" integer,
	"stamp_duty_cents" integer,
	"discount_cents" integer,
	"commission_rate" numeric(6, 2),
	"extra_values" jsonb DEFAULT 'null'::jsonb,
	"note" text,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdf_template_files" (
	"id" serial PRIMARY KEY NOT NULL,
	"stored_name" varchar(512) NOT NULL,
	"content" "bytea" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "pdf_template_files_stored_name_unique" UNIQUE("stored_name")
);
--> statement-breakpoint
CREATE TABLE "accounting_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"invoice_id" integer,
	"payment_id" integer,
	"doc_type" varchar(30) NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"stored_path" varchar(500) NOT NULL,
	"file_size" integer,
	"mime_type" varchar(128),
	"uploaded_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accounting_invoice_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"invoice_id" integer NOT NULL,
	"policy_id" integer NOT NULL,
	"policy_premium_id" integer,
	"line_key" varchar(64),
	"amount_cents" integer NOT NULL,
	"gain_cents" integer DEFAULT 0,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accounting_invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"organisation_id" integer NOT NULL,
	"invoice_number" varchar(100) NOT NULL,
	"invoice_type" varchar(30) NOT NULL,
	"direction" varchar(20) NOT NULL,
	"premium_type" varchar(30) NOT NULL,
	"entity_policy_id" integer,
	"entity_type" varchar(20) NOT NULL,
	"entity_name" varchar(256),
	"schedule_id" integer,
	"parent_invoice_id" integer,
	"total_amount_cents" integer DEFAULT 0 NOT NULL,
	"paid_amount_cents" integer DEFAULT 0 NOT NULL,
	"currency" varchar(8) DEFAULT 'HKD' NOT NULL,
	"invoice_date" date,
	"due_date" date,
	"period_start" date,
	"period_end" date,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"document_status" jsonb,
	"notes" text,
	"cancellation_date" date,
	"refund_reason" text,
	"verified_by" integer,
	"verified_at" timestamp,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accounting_payment_schedules" (
	"id" serial PRIMARY KEY NOT NULL,
	"organisation_id" integer NOT NULL,
	"entity_policy_id" integer,
	"entity_type" varchar(20) NOT NULL,
	"entity_name" varchar(256),
	"frequency" varchar(20) DEFAULT 'monthly' NOT NULL,
	"billing_day" integer,
	"currency" varchar(8) DEFAULT 'HKD' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accounting_payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"invoice_id" integer NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" varchar(8) DEFAULT 'HKD' NOT NULL,
	"payment_date" date,
	"payment_method" varchar(50),
	"reference_number" varchar(100),
	"status" varchar(20) DEFAULT 'recorded' NOT NULL,
	"notes" text,
	"submitted_by" integer,
	"verified_by" integer,
	"verified_at" timestamp,
	"rejection_note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_agent_assignments" ADD CONSTRAINT "client_agent_assignments_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_agent_assignments" ADD CONSTRAINT "client_agent_assignments_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_agent_assignments" ADD CONSTRAINT "client_agent_assignments_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_invites" ADD CONSTRAINT "user_invites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cars" ADD CONSTRAINT "cars_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coverages" ADD CONSTRAINT "coverages_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_documents" ADD CONSTRAINT "policy_documents_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_documents" ADD CONSTRAINT "policy_documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_documents" ADD CONSTRAINT "policy_documents_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_schedules" ADD CONSTRAINT "reminder_schedules_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_schedules" ADD CONSTRAINT "reminder_schedules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_send_log" ADD CONSTRAINT "reminder_send_log_schedule_id_reminder_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."reminder_schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_premiums" ADD CONSTRAINT "policy_premiums_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_premiums" ADD CONSTRAINT "policy_premiums_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_premiums" ADD CONSTRAINT "policy_premiums_collaborator_id_policies_id_fk" FOREIGN KEY ("collaborator_id") REFERENCES "public"."policies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_premiums" ADD CONSTRAINT "policy_premiums_insurer_policy_id_policies_id_fk" FOREIGN KEY ("insurer_policy_id") REFERENCES "public"."policies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_premiums" ADD CONSTRAINT "policy_premiums_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_documents" ADD CONSTRAINT "accounting_documents_invoice_id_accounting_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."accounting_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_documents" ADD CONSTRAINT "accounting_documents_payment_id_accounting_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."accounting_payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_documents" ADD CONSTRAINT "accounting_documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_invoice_items" ADD CONSTRAINT "accounting_invoice_items_invoice_id_accounting_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."accounting_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_invoice_items" ADD CONSTRAINT "accounting_invoice_items_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_invoices" ADD CONSTRAINT "accounting_invoices_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_invoices" ADD CONSTRAINT "accounting_invoices_entity_policy_id_policies_id_fk" FOREIGN KEY ("entity_policy_id") REFERENCES "public"."policies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_invoices" ADD CONSTRAINT "accounting_invoices_schedule_id_accounting_payment_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."accounting_payment_schedules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_invoices" ADD CONSTRAINT "accounting_invoices_parent_invoice_id_accounting_invoices_id_fk" FOREIGN KEY ("parent_invoice_id") REFERENCES "public"."accounting_invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_invoices" ADD CONSTRAINT "accounting_invoices_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_invoices" ADD CONSTRAINT "accounting_invoices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_payment_schedules" ADD CONSTRAINT "accounting_payment_schedules_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_payment_schedules" ADD CONSTRAINT "accounting_payment_schedules_entity_policy_id_policies_id_fk" FOREIGN KEY ("entity_policy_id") REFERENCES "public"."policies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_payment_schedules" ADD CONSTRAINT "accounting_payment_schedules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_payments" ADD CONSTRAINT "accounting_payments_invoice_id_accounting_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."accounting_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_payments" ADD CONSTRAINT "accounting_payments_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_payments" ADD CONSTRAINT "accounting_payments_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_log_created_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_log_user_id_idx" ON "audit_log" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "clients_category_primary_id_idx" ON "clients" USING btree ("category","primary_id");--> statement-breakpoint
CREATE INDEX "users_user_type_idx" ON "users" USING btree ("user_type");--> statement-breakpoint
CREATE INDEX "cars_policy_id_idx" ON "cars" USING btree ("policy_id");--> statement-breakpoint
CREATE INDEX "policies_org_created_idx" ON "policies" USING btree ("organisation_id","created_at");--> statement-breakpoint
CREATE INDEX "policies_client_id_idx" ON "policies" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "policies_agent_id_idx" ON "policies" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "form_options_group_key_idx" ON "form_options" USING btree ("group_key");--> statement-breakpoint
CREATE UNIQUE INDEX "form_options_group_value_unique" ON "form_options" USING btree ("group_key","value");--> statement-breakpoint
CREATE UNIQUE INDEX "policy_premiums_policy_line_unique" ON "policy_premiums" USING btree ("policy_id","line_key");--> statement-breakpoint
CREATE INDEX "accounting_documents_invoice_idx" ON "accounting_documents" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "accounting_documents_payment_idx" ON "accounting_documents" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "accounting_invoice_items_invoice_idx" ON "accounting_invoice_items" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "accounting_invoice_items_policy_idx" ON "accounting_invoice_items" USING btree ("policy_id");--> statement-breakpoint
CREATE INDEX "accounting_invoices_org_idx" ON "accounting_invoices" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "accounting_invoices_status_idx" ON "accounting_invoices" USING btree ("status");--> statement-breakpoint
CREATE INDEX "accounting_invoices_entity_idx" ON "accounting_invoices" USING btree ("entity_type","entity_policy_id");--> statement-breakpoint
CREATE INDEX "accounting_invoices_parent_idx" ON "accounting_invoices" USING btree ("parent_invoice_id");--> statement-breakpoint
CREATE INDEX "accounting_payments_invoice_idx" ON "accounting_payments" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "accounting_payments_status_idx" ON "accounting_payments" USING btree ("status");