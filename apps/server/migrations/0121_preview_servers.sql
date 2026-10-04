ALTER TABLE projects ADD COLUMN preview jsonb;

CREATE TABLE preview_servers (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  folder text NOT NULL,
  wanted text NOT NULL CHECK (wanted IN ('running', 'stopped')),
  status text NOT NULL CHECK (status IN ('starting', 'ready', 'failed', 'stopped')),
  url text,
  pid integer,
  restarts integer NOT NULL DEFAULT 0,
  detail text,
  log_tail text NOT NULL DEFAULT '',
  asked_by text NOT NULL CHECK (asked_by IN ('user', 'agent', 'spark')),
  asked_run_id uuid REFERENCES runs (id) ON DELETE SET NULL,
  asked_conversation_id uuid REFERENCES conversations (id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, folder)
);

CREATE TABLE preview_events (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id uuid REFERENCES projects (id) ON DELETE SET NULL,
  conversation_id uuid REFERENCES conversations (id) ON DELETE SET NULL,
  run_id uuid REFERENCES runs (id) ON DELETE SET NULL,
  folder text NOT NULL,
  action text NOT NULL CHECK (action IN ('start', 'ready', 'failed', 'crashed', 'restart', 'stop')),
  asked_by text NOT NULL CHECK (asked_by IN ('user', 'agent', 'spark')),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX preview_events_project_idx ON preview_events (project_id, created_at);

CREATE FUNCTION preview_server_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM notify_change('preview', NULL, NULL);
  RETURN NULL;
END
$$;

CREATE TRIGGER preview_servers_change
  AFTER INSERT OR DELETE OR UPDATE OF wanted, status, url ON preview_servers
  FOR EACH ROW EXECUTE FUNCTION preview_server_changed();
