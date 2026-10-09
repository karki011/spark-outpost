ALTER TABLE ticket_connections
  ADD COLUMN move_statuses jsonb NOT NULL DEFAULT '{}';
