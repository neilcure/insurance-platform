-- Create assignment table to track which agent manages which client over time
create table if not exists "client_agent_assignments" (
  "id" serial primary key,
  "client_id" integer not null references "clients"("id") on delete cascade,
  "agent_id" integer not null references "users"("id") on delete cascade,
  "assigned_at" timestamp not null default now(),
  "unassigned_at" timestamp null,
  "assigned_by" integer references "users"("id") on delete set null
);

-- Ensure only one active assignment (unassigned_at is null) per client
create unique index if not exists "client_agent_assignments_one_active_per_client"
  on "client_agent_assignments" ("client_id")
  where "unassigned_at" is null;

create index if not exists "client_agent_assignments_active_by_agent"
  on "client_agent_assignments" ("agent_id")
  where "unassigned_at" is null;

-- Add client_id to policies if missing (used for scoping policies to a client)
alter table "policies"
  add column if not exists "client_id" integer references "clients"("id") on delete set null;
create index if not exists "policies_client_id_idx" on "policies" ("client_id");

-- Add agent_id to policies to record responsible agent at creation time
alter table "policies"
  add column if not exists "agent_id" integer references "users"("id") on delete set null;
create index if not exists "policies_agent_id_idx" on "policies" ("agent_id");

