ALTER TABLE runs DROP CONSTRAINT runs_status_check;
ALTER TABLE runs ADD CONSTRAINT runs_status_check CHECK (
  status IN (
    'queued', 'running', 'awaiting_approval', 'succeeded', 'failed', 'cancelled', 'outcome_unknown'
  )
);

ALTER TABLE runs
  ADD COLUMN mode text CHECK (mode IN ('chat', 'ask', 'do')),
  ADD COLUMN level text CHECK (level IN ('hands-on', 'balanced', 'hands-off', 'full-auto')),
  ADD COLUMN snapshot_kind text CHECK (snapshot_kind IN ('git', 'files')),
  ADD COLUMN snapshot_ref text,
  ADD COLUMN snapshot_root text,
  ADD COLUMN reverted_at timestamptz;

ALTER TABLE projects ADD COLUMN command_allowlist text[] NOT NULL DEFAULT '{}';

ALTER TABLE provider_connections
  ADD COLUMN level text NOT NULL DEFAULT 'balanced'
    CHECK (level IN ('hands-on', 'balanced', 'hands-off', 'full-auto'));

UPDATE provider_connections SET permission = 'ask';

UPDATE conversations SET overrides = (
  SELECT COALESCE(
    jsonb_object_agg(
      key,
      CASE WHEN value ? 'permission' THEN jsonb_set(value, '{permission}', '"ask"') ELSE value END
    ),
    '{}'::jsonb
  )
  FROM jsonb_each(overrides)
)
WHERE overrides <> '{}'::jsonb;

CREATE TABLE approvals (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
  tool_call_id text NOT NULL,
  rpc_id text,
  kind text NOT NULL CHECK (kind IN ('edit', 'execute', 'other')),
  title text NOT NULL,
  payload jsonb NOT NULL,
  payload_hash text NOT NULL,
  options jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'allowed', 'denied', 'cancelled', 'expired')),
  reason text,
  decision_option_id text,
  scope text CHECK (scope IN ('once', 'run', 'project')),
  decided_by text CHECK (
    decided_by IN (
      'user', 'level', 'run_rule', 'allowlist', 'policy', 'stop', 'timeout', 'recovery'
    )
  ),
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'pending') = (decided_at IS NULL))
);

CREATE INDEX approvals_run_idx ON approvals (run_id, created_at);
CREATE INDEX approvals_pending_idx ON approvals (run_id) WHERE status = 'pending';

CREATE TABLE run_file_backups (
  run_id uuid NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
  path text NOT NULL,
  existed boolean NOT NULL,
  content bytea,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, path),
  CHECK (existed = (content IS NOT NULL))
);
