CREATE TABLE native_terminal_mod_turns (
  run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  turn_id text NOT NULL,
  agent_id text,
  started_at timestamptz,
  duration_ms integer,
  aborted boolean NOT NULL DEFAULT false,
  PRIMARY KEY (run_id, turn_id)
);

CREATE TABLE native_terminal_requests (
  run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  turn_id text NOT NULL,
  step_index integer NOT NULL,
  agent_id text,
  model text NOT NULL,
  input_tokens integer NOT NULL,
  output_tokens integer NOT NULL,
  cached_read_tokens integer NOT NULL,
  cached_write_tokens integer NOT NULL,
  cost_usd numeric(12, 6),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, turn_id, step_index)
);
