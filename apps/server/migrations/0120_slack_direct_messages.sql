ALTER TABLE slack_connections ADD COLUMN user_scopes text[];

CREATE TABLE slack_direct_conversations (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  channel_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('im', 'mpim')),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, channel_id)
);

ALTER TABLE slack_context_items ADD COLUMN kind text NOT NULL DEFAULT 'channel';

CREATE TABLE slack_direct_chats (
  conversation_id uuid PRIMARY KEY REFERENCES conversations (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
