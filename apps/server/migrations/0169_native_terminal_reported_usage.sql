CREATE TABLE native_terminal_reported_usage (
  session_id uuid NOT NULL REFERENCES native_terminal_sessions(id) ON DELETE CASCADE,
  native_session_id text NOT NULL,
  cost_usd numeric(12, 6) NOT NULL,
  models jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, native_session_id)
);
