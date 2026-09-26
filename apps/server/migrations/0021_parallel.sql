CREATE TABLE run_worktrees (
  run_id uuid PRIMARY KEY REFERENCES runs (id) ON DELETE CASCADE,
  orchestration_run_id uuid NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
  repo_root text NOT NULL,
  path text NOT NULL,
  branch text NOT NULL,
  base_commit text NOT NULL,
  result_commit text,
  merged_at timestamptz,
  removed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX run_worktrees_live_idx ON run_worktrees (orchestration_run_id)
  WHERE removed_at IS NULL;

ALTER TABLE orchestrations ADD COLUMN parallel_note text;

ALTER TABLE approvals DROP CONSTRAINT approvals_kind_check;
ALTER TABLE approvals ADD CONSTRAINT approvals_kind_check CHECK (
  kind IN (
    'edit', 'execute', 'other', 'clarify', 'plan', 'retry', 'accept', 'budget', 'merge_conflict'
  )
);
