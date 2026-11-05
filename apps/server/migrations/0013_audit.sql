CREATE TABLE run_protocol_log (
  run_id uuid NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
  seq integer NOT NULL CHECK (seq > 0),
  at timestamptz NOT NULL,
  direction text NOT NULL CHECK (direction IN ('to_agent', 'from_agent')),
  kind text NOT NULL CHECK (kind IN ('request', 'response', 'error', 'notification', 'stderr')),
  method text,
  rpc_id text,
  size_bytes integer NOT NULL CHECK (size_bytes >= 0),
  truncated boolean NOT NULL DEFAULT false,
  payload jsonb NOT NULL,
  prev_hash text,
  hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, seq)
);

CREATE INDEX run_protocol_log_method_idx ON run_protocol_log (run_id, method);

ALTER TABLE runs
  ADD COLUMN used_model text,
  ADD COLUMN used_effort text,
  ADD COLUMN used_mode text,
  ADD COLUMN duration_ms integer,
  ADD COLUMN tool_call_count integer,
  ADD COLUMN cost_source text CHECK (cost_source IN ('reported', 'estimated')),
  ADD COLUMN protocol_log_pruned_at timestamptz;

UPDATE runs SET cost_source = 'reported' WHERE cost_usd IS NOT NULL;
