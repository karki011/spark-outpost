CREATE TABLE chat_files (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
  path text NOT NULL CHECK (char_length(path) BETWEEN 1 AND 1024),
  size bigint NOT NULL CHECK (size >= 0),
  changed_ms double precision NOT NULL,
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  media_type text NOT NULL CHECK (char_length(media_type) BETWEEN 1 AND 100),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX chat_files_conversation ON chat_files (conversation_id, path, created_at DESC);
CREATE INDEX chat_files_run ON chat_files (run_id);
