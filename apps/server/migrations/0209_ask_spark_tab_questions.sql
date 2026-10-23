ALTER TABLE chat_queue DROP CONSTRAINT IF EXISTS chat_queue_origin_check;
ALTER TABLE chat_queue
  ADD CONSTRAINT chat_queue_origin_check CHECK (origin IN ('voice', 'assistant', 'pages'));

ALTER TABLE chat_queue
  ADD COLUMN attachment_ids uuid[] NOT NULL DEFAULT '{}';

ALTER TABLE runs DROP CONSTRAINT IF EXISTS runs_source_check;
ALTER TABLE runs
  ADD CONSTRAINT runs_source_check
  CHECK (source IN (
    'ui', 'e2e', 'bench', 'digest', 'ticket', 'pr_follow_up', 'queue', 'slack', 'outpost',
    'agent_cycle', 'spark_rule', 'voice', 'assistant', 'pages'
  ));
