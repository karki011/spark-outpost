CREATE TABLE native_terminal_steps (
  run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  tool_use_id text NOT NULL,
  name text NOT NULL,
  agent_id text,
  started_at timestamptz,
  ended_at timestamptz,
  failed boolean NOT NULL DEFAULT false,
  PRIMARY KEY (run_id, tool_use_id)
);
