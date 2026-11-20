ALTER TABLE workflow_triggers ADD COLUMN chat_started boolean NOT NULL DEFAULT false;

ALTER TABLE workflow_runs DROP CONSTRAINT workflow_runs_trigger_kind_check;
ALTER TABLE workflow_runs
  ADD CONSTRAINT workflow_runs_trigger_kind_check
  CHECK (trigger_kind IN ('turn_changed', 'before_publish', 'commit', 'pull_request', 'chat_started'));

ALTER TABLE workflow_trigger_events DROP CONSTRAINT workflow_trigger_events_kind_check;
ALTER TABLE workflow_trigger_events
  ADD CONSTRAINT workflow_trigger_events_kind_check
  CHECK (kind IN ('turn_changed', 'commit', 'pull_request', 'chat_started'));
