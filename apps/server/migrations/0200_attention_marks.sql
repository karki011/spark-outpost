CREATE TABLE attention_marks (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  key text NOT NULL CHECK (char_length(key) BETWEEN 1 AND 160),
  conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL DEFAULT now(),
  set_aside_at timestamptz,
  dismissed_at timestamptz,
  PRIMARY KEY (workspace_id, key)
);

CREATE INDEX attention_marks_conversation ON attention_marks (conversation_id);

DELETE FROM island_requests WHERE kind = 'set_aside';

ALTER TABLE island_requests
  DROP CONSTRAINT island_requests_kind_check,
  ADD CONSTRAINT island_requests_kind_check CHECK (kind IN ('snooze_meeting', 'join_meeting'));

ALTER TABLE native_terminal_sessions ADD COLUMN waiting_since timestamptz;

UPDATE native_terminal_sessions SET waiting_since = updated_at
WHERE state IN ('waiting_for_permission', 'waiting_for_input');
