CREATE TABLE run_prompt_cache (
  run_id uuid PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
  first_key text NOT NULL,
  first_write integer NOT NULL CHECK (first_write >= 0),
  last_key text NOT NULL,
  last_context integer NOT NULL CHECK (last_context >= 0),
  last_at timestamptz NOT NULL,
  model text,
  ttl_seconds integer CHECK (ttl_seconds IN (300, 3600))
);

CREATE TABLE native_terminal_long_writes (
  run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  model text NOT NULL,
  tokens integer NOT NULL CHECK (tokens >= 0),
  PRIMARY KEY (run_id, model)
);

ALTER TABLE native_terminal_sessions
  ADD COLUMN cache_ttl_seconds integer CHECK (cache_ttl_seconds IN (300, 3600)),
  ADD COLUMN cache_resume jsonb;
