CREATE TABLE run_advice (
  run_id uuid NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('intake')),
  jev_status text NOT NULL
    CHECK (jev_status IN ('answered', 'failed', 'timed_out', 'not_connected')),
  jev_input_tokens integer CHECK (jev_input_tokens >= 0),
  jev_cost_usd numeric CHECK (jev_cost_usd >= 0),
  body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, purpose)
);

ALTER TABLE conversations
  ADD COLUMN model_routing text NOT NULL DEFAULT 'pinned'
    CHECK (model_routing IN ('pinned', 'auto'));
