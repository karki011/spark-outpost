ALTER TABLE approvals DROP CONSTRAINT approvals_kind_check;
ALTER TABLE approvals ADD CONSTRAINT approvals_kind_check CHECK (
  kind IN (
    'edit', 'execute', 'other', 'clarify', 'plan', 'retry', 'accept', 'budget', 'merge_conflict',
    'stuck'
  )
);

ALTER TABLE run_advice DROP CONSTRAINT run_advice_purpose_check;
ALTER TABLE run_advice
  ADD CONSTRAINT run_advice_purpose_check
  CHECK (purpose IN ('intake', 'route', 'transition', 'parallel', 'build_style', 'watchdog'));
