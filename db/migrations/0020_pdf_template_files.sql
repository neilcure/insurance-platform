CREATE TABLE IF NOT EXISTS "pdf_template_files" (
  "id" serial PRIMARY KEY,
  "stored_name" varchar(512) NOT NULL UNIQUE,
  "content" bytea NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now()
);
