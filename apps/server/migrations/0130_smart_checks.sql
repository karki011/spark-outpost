CREATE TABLE check_baselines (
  repo text NOT NULL,
  base_tree text NOT NULL,
  cwd text NOT NULL,
  command_hash text NOT NULL,
  command text NOT NULL,
  exit_code integer,
  timed_out boolean NOT NULL DEFAULT false,
  failures text[] NOT NULL DEFAULT '{}',
  output_shape text NOT NULL DEFAULT '',
  duration_ms integer NOT NULL CHECK (duration_ms >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (repo, base_tree, cwd, command_hash)
);

ALTER TABLE run_worktrees
  DROP CONSTRAINT run_worktrees_deps_method_check,
  ADD CONSTRAINT run_worktrees_deps_method_check
    CHECK (deps_method IN ('clone', 'copy', 'offline_install', 'install', 'skipped')),
  ADD COLUMN deps_lockfile_matched boolean;
