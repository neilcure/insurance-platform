CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb DEFAULT 'null'::jsonb,
	"updated_at" timestamp DEFAULT now()
);
