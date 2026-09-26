CREATE TABLE attachments (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  message_id uuid REFERENCES messages (id) ON DELETE CASCADE,
  name text NOT NULL,
  media_type text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('image', 'text')),
  size integer NOT NULL CHECK (size >= 0),
  data bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX attachments_message_idx ON attachments (message_id);
