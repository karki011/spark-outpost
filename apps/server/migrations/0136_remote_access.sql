CREATE TABLE remote_access_settings (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
  hostname text CHECK (hostname IS NULL OR length(hostname) BETWEEN 1 AND 253),
  can_settings boolean NOT NULL DEFAULT true,
  can_connections boolean NOT NULL DEFAULT true,
  can_projects boolean NOT NULL DEFAULT true,
  can_agent_mode boolean NOT NULL DEFAULT true,
  can_high_risk_cards boolean NOT NULL DEFAULT true,
  can_sign_ins boolean NOT NULL DEFAULT false,
  can_reset boolean NOT NULL DEFAULT false,
  can_devices boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE remote_devices (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  token_hash text NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE INDEX remote_devices_workspace_idx ON remote_devices (workspace_id, created_at);

CREATE TABLE remote_audit (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  device_id uuid REFERENCES remote_devices (id) ON DELETE SET NULL,
  device_name text,
  action text NOT NULL CHECK (length(action) BETWEEN 1 AND 40),
  method text,
  path text,
  status integer,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX remote_audit_workspace_idx ON remote_audit (workspace_id, created_at);
