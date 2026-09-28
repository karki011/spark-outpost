CREATE TABLE message_annotations (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  source_message_id uuid NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('quote', 'ask', 'comment')),
  quote text NOT NULL,
  note text NOT NULL DEFAULT '',
  anchor jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX message_annotations_conversation_idx
  ON message_annotations (conversation_id, created_at);
CREATE INDEX message_annotations_message_idx ON message_annotations (message_id);
CREATE INDEX message_annotations_source_idx ON message_annotations (source_message_id);
