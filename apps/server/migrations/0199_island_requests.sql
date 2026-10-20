CREATE TABLE island_requests (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('snooze_meeting', 'join_meeting', 'set_aside')),
  target text NOT NULL CHECK (char_length(target) BETWEEN 1 AND 600),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX island_requests_workspace ON island_requests (workspace_id, created_at);
