CREATE TABLE "client_agent_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"agent_id" integer NOT NULL,
	"assigned_at" timestamp DEFAULT now() NOT NULL,
	"unassigned_at" timestamp,
	"assigned_by" integer
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
ALTER TABLE "user_counters" ALTER COLUMN "user_type" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "user_type" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "user_type" SET DEFAULT 'agent'::text;--> statement-breakpoint
DROP TYPE "public"."user_type";--> statement-breakpoint
CREATE TYPE "public"."user_type" AS ENUM('admin', 'agent', 'direct_client', 'service_provider', 'internal_staff', 'accounting');--> statement-breakpoint
ALTER TABLE "user_counters" ALTER COLUMN "user_type" SET DATA TYPE "public"."user_type" USING "user_type"::"public"."user_type";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "user_type" SET DEFAULT 'agent'::"public"."user_type";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "user_type" SET DATA TYPE "public"."user_type" USING "user_type"::"public"."user_type";--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "created_by" integer;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "user_number" text;--> statement-breakpoint
ALTER TABLE "policies" ADD COLUMN "client_id" integer;--> statement-breakpoint
ALTER TABLE "policies" ADD COLUMN "agent_id" integer;--> statement-breakpoint
ALTER TABLE "policies" ADD COLUMN "created_by" integer;--> statement-breakpoint
ALTER TABLE "policies" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "client_agent_assignments" ADD CONSTRAINT "client_agent_assignments_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_agent_assignments" ADD CONSTRAINT "client_agent_assignments_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_agent_assignments" ADD CONSTRAINT "client_agent_assignments_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "form_options_group_key_idx" ON "form_options" USING btree ("group_key");--> statement-breakpoint
CREATE UNIQUE INDEX "form_options_group_value_unique" ON "form_options" USING btree ("group_key","value");