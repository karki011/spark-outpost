ALTER TABLE runs DROP CONSTRAINT IF EXISTS runs_source_check;
ALTER TABLE runs
  ADD CONSTRAINT runs_source_check
  CHECK (source IN (
    'ui', 'e2e', 'bench', 'digest', 'ticket', 'pr_follow_up', 'queue', 'slack', 'outpost',
    'agent_cycle', 'spark_rule', 'voice', 'assistant', 'pages', 'workflow'
  ));

CREATE TABLE workflow_runs (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  workflow_id text NOT NULL,
  workflow_name text NOT NULL,
  definition jsonb NOT NULL,
  kind text NOT NULL CHECK (kind IN ('run', 'test')),
  source text NOT NULL CHECK (source IN ('manual', 'mention', 'schedule', 'catch_up')),
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'succeeded', 'failed', 'cancelled', 'outcome_unknown')),
  conversation_id uuid REFERENCES conversations (id) ON DELETE SET NULL,
  run_id uuid UNIQUE REFERENCES runs (id) ON DELETE SET NULL,
  message text NOT NULL DEFAULT '',
  continues boolean NOT NULL DEFAULT false,
  stopped_by text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE INDEX workflow_runs_workflow ON workflow_runs (workspace_id, workflow_id, started_at DESC);
CREATE INDEX workflow_runs_open ON workflow_runs (status) WHERE status = 'running';

CREATE TABLE workflow_run_steps (
  workflow_run_id uuid NOT NULL REFERENCES workflow_runs (id) ON DELETE CASCADE,
  step_id text NOT NULL,
  position integer NOT NULL,
  spark_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'waiting'
    CHECK (state IN ('waiting', 'running', 'succeeded', 'failed', 'skipped', 'cancelled')),
  run_id uuid REFERENCES runs (id) ON DELETE SET NULL,
  note text,
  started_at timestamptz,
  finished_at timestamptz,
  PRIMARY KEY (workflow_run_id, step_id)
);

CREATE INDEX workflow_run_steps_run ON workflow_run_steps (run_id) WHERE run_id IS NOT NULL;
