ALTER TABLE projects
  ADD COLUMN build_style text NOT NULL DEFAULT 'off'
  CHECK (build_style IN ('off', 'lite', 'lean'));

ALTER TABLE run_artifacts DROP CONSTRAINT run_artifacts_kind_check;
ALTER TABLE run_artifacts
  ADD CONSTRAINT run_artifacts_kind_check
  CHECK (kind IN ('plan', 'changes', 'check', 'review', 'advice', 'shortcuts'));

ALTER TABLE run_advice DROP CONSTRAINT run_advice_purpose_check;
ALTER TABLE run_advice
  ADD CONSTRAINT run_advice_purpose_check
  CHECK (purpose IN ('intake', 'route', 'transition', 'parallel', 'build_style'));

ALTER TABLE run_worktrees
  ADD COLUMN deps_method text
    CHECK (deps_method IN ('clone', 'copy', 'offline_install', 'skipped')),
  ADD COLUMN deps_ms integer CHECK (deps_ms >= 0),
  ADD COLUMN deps_waited_ms integer CHECK (deps_waited_ms >= 0),
  ADD COLUMN deps_note text;
