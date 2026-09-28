ALTER TABLE task_links DROP CONSTRAINT task_links_source_check;
ALTER TABLE task_links
  ADD CONSTRAINT task_links_source_check
  CHECK (source IN ('tool_output', 'resource_link', 'agent_text', 'user', 'ship'));

ALTER TABLE run_protocol_log DROP CONSTRAINT run_protocol_log_kind_check;
ALTER TABLE run_protocol_log
  ADD CONSTRAINT run_protocol_log_kind_check
  CHECK (kind IN ('request', 'response', 'error', 'notification', 'stderr', 'check', 'ship'));

CREATE TABLE task_ships (
  task_id uuid PRIMARY KEY REFERENCES tasks (id) ON DELETE CASCADE,
  root_path text NOT NULL,
  branch text NOT NULL,
  base_branch text,
  remote text,
  last_commit text,
  pushed_at timestamptz,
  pr_url text,
  pr_number integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE github_tokens (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
  host text NOT NULL,
  login text NOT NULL,
  scopes text[] NOT NULL DEFAULT '{}',
  expires_at timestamptz,
  repos jsonb NOT NULL DEFAULT '[]',
  validated_at timestamptz NOT NULL DEFAULT now()
);
