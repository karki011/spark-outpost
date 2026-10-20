ALTER TABLE profiles
  ADD COLUMN assistant_acts text NOT NULL DEFAULT 'manual'
    CHECK (assistant_acts IN ('manual', 'act'));

ALTER TABLE chat_queue
  ADD COLUMN origin text CHECK (origin IN ('voice', 'assistant'));

ALTER TABLE runs DROP CONSTRAINT IF EXISTS runs_source_check;
ALTER TABLE runs
  ADD CONSTRAINT runs_source_check
  CHECK (source IN (
    'ui', 'e2e', 'bench', 'digest', 'ticket', 'pr_follow_up', 'queue', 'slack', 'outpost',
    'agent_cycle', 'spark_rule', 'voice', 'assistant'
  ));
