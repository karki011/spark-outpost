ALTER TABLE task_links DROP CONSTRAINT task_links_source_check;
ALTER TABLE task_links
  ADD CONSTRAINT task_links_source_check
  CHECK (source IN ('tool_output', 'resource_link', 'agent_text', 'user', 'ship', 'ticket'));

CREATE TABLE ticket_connections (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('linear', 'jira')),
  api_url text NOT NULL,
  email text,
  account text NOT NULL,
  move_on_ship boolean NOT NULL DEFAULT true,
  status_map jsonb NOT NULL DEFAULT '{}',
  validated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, source)
);

CREATE TABLE tickets (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('linear', 'jira')),
  key text NOT NULL,
  title text NOT NULL,
  status text NOT NULL CHECK (status IN ('todo', 'in_progress', 'in_review', 'done')),
  status_name text NOT NULL,
  url text NOT NULL,
  updated_at timestamptz NOT NULL,
  cached_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, source, key)
);

CREATE TABLE task_tickets (
  task_id uuid NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL,
  source text NOT NULL,
  ticket_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, source, ticket_key),
  FOREIGN KEY (workspace_id, source, ticket_key)
    REFERENCES tickets (workspace_id, source, key) ON DELETE CASCADE
);

CREATE INDEX task_tickets_ticket_idx ON task_tickets (workspace_id, source, ticket_key);

CREATE TABLE ticket_events (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('linear', 'jira')),
  action text NOT NULL CHECK (
    action IN ('connect', 'disconnect', 'settings', 'start', 'transition', 'comment', 'link_pr')
  ),
  ticket_key text,
  task_id uuid REFERENCES tasks (id) ON DELETE SET NULL,
  outcome text NOT NULL CHECK (outcome IN ('succeeded', 'skipped', 'failed')),
  detail jsonb NOT NULL DEFAULT '{}',
  at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ticket_events_workspace_idx ON ticket_events (workspace_id, at DESC);
