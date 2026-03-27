-- Performance indexes for frequently queried columns that were missing indexes

-- cars.policy_id: used in every policy list join (LEFT JOIN cars ON cars.policy_id = policies.id)
CREATE INDEX IF NOT EXISTS cars_policy_id_idx ON cars(policy_id);

-- policies.organisation_id: used for org-scoped queries + sorting by created_at
CREATE INDEX IF NOT EXISTS policies_org_created_idx ON policies(organisation_id, created_at DESC);

-- clients(category, primary_id): used for client upsert/lookup
CREATE INDEX IF NOT EXISTS clients_category_primary_id_idx ON clients(category, primary_id);

-- users.user_type: used for agent listing (WHERE user_type = 'agent')
CREATE INDEX IF NOT EXISTS users_user_type_idx ON users(user_type);

-- policies.agent_id: agent-scoped policy queries (WHERE agent_id = ?)
-- Migration 0013 may have added this, but ensure it exists
CREATE INDEX IF NOT EXISTS policies_agent_id_idx ON policies(agent_id) WHERE agent_id IS NOT NULL;

-- policies.client_id: client-scoped policy queries
CREATE INDEX IF NOT EXISTS policies_client_id_idx ON policies(client_id) WHERE client_id IS NOT NULL;

-- audit_log.user_id: for user activity lookups
CREATE INDEX IF NOT EXISTS audit_log_user_id_idx ON audit_log(user_id) WHERE user_id IS NOT NULL;
