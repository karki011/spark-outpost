ALTER TABLE ticket_connections DROP CONSTRAINT ticket_connections_source_check;
ALTER TABLE ticket_connections
  ADD CONSTRAINT ticket_connections_source_check
  CHECK (source IN ('linear', 'jira', 'servicenow'));

ALTER TABLE tickets DROP CONSTRAINT tickets_source_check;
ALTER TABLE tickets
  ADD CONSTRAINT tickets_source_check CHECK (source IN ('linear', 'jira', 'servicenow'));

ALTER TABLE ticket_events DROP CONSTRAINT ticket_events_source_check;
ALTER TABLE ticket_events
  ADD CONSTRAINT ticket_events_source_check CHECK (source IN ('linear', 'jira', 'servicenow'));

ALTER TABLE ticket_development DROP CONSTRAINT ticket_development_source_check;
ALTER TABLE ticket_development
  ADD CONSTRAINT ticket_development_source_check
  CHECK (source IN ('linear', 'jira', 'servicenow'));

ALTER TABLE ticket_connections
  ADD COLUMN auth_kind text CHECK (auth_kind IN ('basic', 'api_key')),
  ADD COLUMN login text,
  ADD COLUMN servicenow_types jsonb;
