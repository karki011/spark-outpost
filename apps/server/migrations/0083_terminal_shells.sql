CREATE TABLE terminal_shells (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES conversations (id) ON DELETE CASCADE,
  label text NOT NULL CHECK (length(label) <= 200),
  cwd text NOT NULL,
  pid integer NOT NULL,
  opened_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX terminal_shells_workspace_idx ON terminal_shells (workspace_id, opened_at);
