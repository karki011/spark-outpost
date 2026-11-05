ALTER TABLE approvals ADD COLUMN auto_continue_at timestamptz;

ALTER TABLE approvals DROP CONSTRAINT approvals_decided_by_check;
ALTER TABLE approvals ADD CONSTRAINT approvals_decided_by_check CHECK (
  decided_by IN (
    'user', 'level', 'run_rule', 'allowlist', 'policy', 'stop', 'timeout', 'recovery', 'auto'
  )
);

ALTER TABLE profiles ADD COLUMN auto_continue_seconds integer DEFAULT 10
  CHECK (auto_continue_seconds IS NULL OR auto_continue_seconds BETWEEN 1 AND 600);
