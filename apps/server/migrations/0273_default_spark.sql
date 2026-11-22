ALTER TABLE profiles
  ADD COLUMN default_teammate_id uuid REFERENCES teammates (id) ON DELETE SET NULL;

CREATE TABLE chat_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('spark_settings')),
  name text NOT NULL,
  at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX chat_notes_conversation ON chat_notes (conversation_id, at);
