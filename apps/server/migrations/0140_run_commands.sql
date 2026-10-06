CREATE TABLE run_commands (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  command text NOT NULL CHECK (length(command) <= 4000),
  cwd text,
  live boolean NOT NULL,
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed', 'interrupted')),
  exit_code integer,
  output text NOT NULL DEFAULT '' CHECK (length(output) <= 65536),
  output_chars bigint NOT NULL DEFAULT 0 CHECK (output_chars >= 0),
  text_offset integer CHECK (text_offset >= 0),
  text_before text CHECK (length(text_before) <= 80),
  text_held integer CHECK (text_held >= 0),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE INDEX run_commands_conversation_idx ON run_commands (conversation_id, started_at, id);
CREATE INDEX run_commands_run_idx ON run_commands (run_id);
