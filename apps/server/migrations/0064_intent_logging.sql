ALTER TABLE runs
  ADD COLUMN picked_mode text CHECK (picked_mode IN ('chat', 'ask', 'do')),
  ADD COLUMN start_as text CHECK (start_as IN ('change')),
  ADD COLUMN source text CHECK (source IN ('ui', 'e2e', 'bench', 'digest', 'ticket')),
  ADD COLUMN project_roots text[];

ALTER TABLE approvals ADD COLUMN default_option_id text;

ALTER TABLE run_advice DROP CONSTRAINT run_advice_purpose_check;
ALTER TABLE run_advice
  ADD CONSTRAINT run_advice_purpose_check
  CHECK (
    purpose IN (
      'intake', 'route', 'transition', 'parallel', 'build_style', 'watchdog', 'policy', 'verify',
      'scan', 'rank', 'route_shadow', 'plan_agreed', 'finding', 'clarify'
    )
  );
