ALTER TABLE run_advice ADD COLUMN policy_version text;

ALTER TABLE run_advice DROP CONSTRAINT run_advice_purpose_check;
ALTER TABLE run_advice
  ADD CONSTRAINT run_advice_purpose_check
  CHECK (
    purpose IN (
      'intake', 'route', 'transition', 'parallel', 'build_style', 'watchdog', 'policy', 'verify'
    )
  );

ALTER TABLE orchestrations DROP COLUMN parallel_note;

ALTER TABLE profiles DROP COLUMN allow_frontier;
ALTER TABLE profiles ADD COLUMN jev_diffs boolean NOT NULL DEFAULT true;
