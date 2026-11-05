CREATE TABLE shell_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  shell_id text NOT NULL UNIQUE CHECK (char_length(shell_id) BETWEEN 1 AND 200),
  label text NOT NULL CHECK (char_length(label) <= 200),
  message text NOT NULL CHECK (char_length(message) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX shell_alerts_conversation_idx ON shell_alerts (conversation_id, created_at);
CREATE INDEX shell_alerts_created_idx ON shell_alerts (created_at);
