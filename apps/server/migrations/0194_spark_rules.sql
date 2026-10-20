ALTER TABLE profiles
  ADD COLUMN gh_workflows text NOT NULL DEFAULT 'mode' CHECK (gh_workflows IN ('refused', 'mode')),
  ADD COLUMN gh_allowed text[] NOT NULL DEFAULT '{}' CHECK (cardinality(gh_allowed) <= 20);

ALTER TABLE approvals
  ADD COLUMN rule_answer text CHECK (rule_answer IN ('allow_group', 'allow_once', 'keep')),
  ADD COLUMN rule_retry_run_id uuid REFERENCES runs (id) ON DELETE SET NULL;

CREATE INDEX approvals_rule_retry_run ON approvals (rule_retry_run_id)
  WHERE rule_retry_run_id IS NOT NULL;

ALTER TABLE chat_queue
  ADD COLUMN spark_rule_card_id uuid REFERENCES approvals (id) ON DELETE SET NULL;

ALTER TABLE runs DROP CONSTRAINT IF EXISTS runs_source_check;
ALTER TABLE runs
  ADD CONSTRAINT runs_source_check
  CHECK (source IN (
    'ui', 'e2e', 'bench', 'digest', 'ticket', 'pr_follow_up', 'queue', 'slack', 'outpost',
    'agent_cycle', 'spark_rule'
  ));
