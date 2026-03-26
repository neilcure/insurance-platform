-- Link client records to user portal accounts
ALTER TABLE clients ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX clients_user_id_unique ON clients(user_id) WHERE user_id IS NOT NULL;
