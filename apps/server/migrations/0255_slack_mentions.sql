CREATE TABLE slack_mentions (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  channel_id text NOT NULL,
  ts text NOT NULL,
  author_name text NOT NULL,
  place text NOT NULL,
  permalink text NOT NULL,
  mentioned_at timestamptz NOT NULL,
  found_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, channel_id, ts)
);

CREATE INDEX slack_mentions_recent ON slack_mentions (workspace_id, mentioned_at);

ALTER TABLE attention_marks ALTER COLUMN conversation_id DROP NOT NULL;
