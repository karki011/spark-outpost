ALTER TABLE workflow_runs DROP CONSTRAINT IF EXISTS workflow_runs_source_check;
ALTER TABLE workflow_runs
  ADD CONSTRAINT workflow_runs_source_check
  CHECK (source IN ('manual', 'mention', 'schedule', 'catch_up', 'trigger', 'agent'));
