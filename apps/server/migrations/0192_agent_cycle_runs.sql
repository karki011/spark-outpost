ALTER TABLE runs ALTER COLUMN user_message_id DROP NOT NULL;

ALTER TABLE runs DROP CONSTRAINT IF EXISTS runs_source_check;
ALTER TABLE runs
  ADD CONSTRAINT runs_source_check
  CHECK (source IN (
    'ui', 'e2e', 'bench', 'digest', 'ticket', 'pr_follow_up', 'queue', 'slack', 'outpost',
    'agent_cycle'
  ));

ALTER TABLE runs
  ADD CONSTRAINT runs_user_message_check
  CHECK (user_message_id IS NOT NULL OR (source = 'agent_cycle' AND parent_run_id IS NULL));
