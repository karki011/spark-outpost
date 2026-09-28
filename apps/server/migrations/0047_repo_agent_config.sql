CREATE TABLE project_agent_settings (
  project_id uuid PRIMARY KEY REFERENCES projects (id) ON DELETE CASCADE,
  instructions boolean NOT NULL DEFAULT true,
  skills boolean NOT NULL DEFAULT true,
  commands boolean NOT NULL DEFAULT true,
  subagents boolean NOT NULL DEFAULT true,
  hooks_fingerprint text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE mcp_servers (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source ~ '^(project|user|imported:[a-z0-9-]+)$'),
  project_id uuid REFERENCES projects (id) ON DELETE CASCADE,
  name text NOT NULL,
  transport text NOT NULL CHECK (transport IN ('stdio', 'http', 'sse')),
  config jsonb NOT NULL,
  fingerprint text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((source = 'project') = (project_id IS NOT NULL))
);

CREATE UNIQUE INDEX mcp_servers_project_name_idx
  ON mcp_servers (project_id, name) WHERE source = 'project';
CREATE UNIQUE INDEX mcp_servers_workspace_name_idx
  ON mcp_servers (workspace_id, source, name) WHERE source <> 'project';

CREATE TABLE mcp_server_enablements (
  server_id uuid NOT NULL REFERENCES mcp_servers (id) ON DELETE CASCADE,
  scope text NOT NULL CHECK (scope IN ('global', 'project', 'chat')),
  scope_key text NOT NULL,
  enabled boolean NOT NULL,
  fingerprint text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (server_id, scope, scope_key)
);

CREATE TABLE agent_config_audit (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id uuid REFERENCES projects (id) ON DELETE SET NULL,
  subject text NOT NULL CHECK (subject IN ('instructions', 'skills', 'commands', 'subagents', 'hooks', 'mcp')),
  target text,
  enabled boolean NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX agent_config_audit_project_idx ON agent_config_audit (project_id, created_at);

ALTER TABLE runs ADD COLUMN followed_instructions text[];
