CREATE TABLE ticket_development (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('linear', 'jira')),
  key text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('ok', 'unavailable')),
  payload jsonb,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, source, key)
);
