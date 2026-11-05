CREATE TABLE run_observations (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  source text NOT NULL CHECK (
    source IN ('secret_file', 'secret_output', 'private_data')
  ),
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, source, label)
);

CREATE INDEX run_observations_conversation_idx ON run_observations (conversation_id, created_at);
