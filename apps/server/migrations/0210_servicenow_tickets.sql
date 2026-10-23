ALTER TABLE ticket_connections
  ADD COLUMN inbox_scope text NOT NULL DEFAULT 'groups' CHECK (inbox_scope IN ('me', 'groups'));

UPDATE ticket_connections SET move_on_ship = false, move_on_merge = false
  WHERE source = 'servicenow';
