CREATE TABLE profiles (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces (id),
  display_name text NOT NULL DEFAULT '',
  default_provider text,
  onboarding_completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE provider_connections (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  provider text NOT NULL,
  method text NOT NULL CHECK (method IN ('cli', 'api_key')),
  detail text NOT NULL,
  models jsonb NOT NULL DEFAULT '[]',
  model text,
  permission text NOT NULL,
  effort text NOT NULL,
  verified_at timestamptz NOT NULL,
  disconnected_at timestamptz,
  PRIMARY KEY (workspace_id, provider)
);
