CREATE TABLE "clients" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_number" text NOT NULL,
	"category" text NOT NULL,
	"display_name" text NOT NULL,
	"primary_id" text NOT NULL,
	"contact_phone" text,
	"extra_attributes" jsonb DEFAULT 'null'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "clients_client_number_unique" UNIQUE("client_number")
);
