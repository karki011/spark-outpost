CREATE TABLE advisor_connections (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  advisor text NOT NULL,
  method text NOT NULL CHECK (method IN ('api_key')),
  detail text NOT NULL,
  summary text,
  models jsonb NOT NULL DEFAULT '[]',
  model text,
  verified_at timestamptz NOT NULL,
  disconnected_at timestamptz,
  PRIMARY KEY (workspace_id, advisor)
);
