CREATE TABLE IF NOT EXISTS browser_history (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  profile text NOT NULL CHECK (profile IN ('personal', 'work')),
  url text NOT NULL,
  title text NOT NULL DEFAULT '',
  visit_count integer NOT NULL DEFAULT 1 CHECK (visit_count > 0),
  last_visited_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, profile, url)
);

CREATE INDEX IF NOT EXISTS browser_history_recent_idx
  ON browser_history (workspace_id, profile, last_visited_at DESC);
