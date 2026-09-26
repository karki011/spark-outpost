ALTER TABLE runs
  ADD COLUMN parent_run_id uuid REFERENCES runs (id) ON DELETE CASCADE,
  ADD COLUMN role text CHECK (role IN ('scout', 'architect', 'builder', 'critic')),
  ADD COLUMN step_index integer CHECK (step_index >= 0),
  ADD COLUMN attempt integer CHECK (attempt > 0),
  ADD COLUMN agent_label text,
  ADD COLUMN prompt text,
  ADD COLUMN route jsonb,
  ADD CHECK (parent_run_id IS NULL OR role IS NOT NULL);

ALTER TABLE runs DROP CONSTRAINT runs_user_message_id_key;
CREATE UNIQUE INDEX runs_user_message_top_idx ON runs (user_message_id)
  WHERE parent_run_id IS NULL;
CREATE INDEX runs_parent_idx ON runs (parent_run_id, created_at)
  WHERE parent_run_id IS NOT NULL;

CREATE TABLE orchestrations (
  run_id uuid PRIMARY KEY REFERENCES runs (id) ON DELETE CASCADE,
  phase text NOT NULL CHECK (
    phase IN ('intake', 'scouting', 'planning', 'building', 'reviewing', 'waiting', 'finished')
  ),
  depth text NOT NULL CHECK (depth IN ('direct', 'execute', 'plan_execute', 'plan_execute_review')),
  depth_source text NOT NULL CHECK (depth_source IN ('jev', 'rules', 'user')),
  risk text NOT NULL CHECK (risk IN ('read-only', 'edits', 'multi-file', 'destructive')),
  routing text NOT NULL CHECK (routing IN ('pinned', 'auto')),
  retries integer NOT NULL DEFAULT 0 CHECK (retries >= 0),
  active_ms integer NOT NULL DEFAULT 0 CHECK (active_ms >= 0),
  tool_calls integer NOT NULL DEFAULT 0 CHECK (tool_calls >= 0),
  active_limit_ms integer NOT NULL CHECK (active_limit_ms > 0),
  tool_call_limit integer NOT NULL CHECK (tool_call_limit > 0),
  cost_cap_usd numeric CHECK (cost_cap_usd > 0),
  exceeded text CHECK (exceeded IN ('time', 'tool_calls', 'cost')),
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE approvals DROP CONSTRAINT approvals_kind_check;
ALTER TABLE approvals ADD CONSTRAINT approvals_kind_check CHECK (
  kind IN ('edit', 'execute', 'other', 'clarify', 'plan', 'retry', 'accept', 'budget')
);
ALTER TABLE approvals ADD COLUMN note text;

ALTER TABLE run_advice DROP CONSTRAINT run_advice_pkey;
ALTER TABLE run_advice DROP CONSTRAINT run_advice_purpose_check;
ALTER TABLE run_advice DROP CONSTRAINT run_advice_jev_status_check;
ALTER TABLE run_advice
  ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ADD COLUMN child_run_id uuid REFERENCES runs (id) ON DELETE SET NULL,
  ADD COLUMN role text CHECK (role IN ('scout', 'architect', 'builder', 'critic')),
  ADD COLUMN step_index integer CHECK (step_index >= 0),
  ADD CONSTRAINT run_advice_purpose_check CHECK (purpose IN ('intake', 'route', 'transition')),
  ADD CONSTRAINT run_advice_jev_status_check CHECK (
    jev_status IN ('answered', 'failed', 'timed_out', 'not_connected', 'not_asked')
  );
CREATE UNIQUE INDEX run_advice_intake_idx ON run_advice (run_id) WHERE purpose = 'intake';
CREATE INDEX run_advice_run_idx ON run_advice (run_id, created_at);
