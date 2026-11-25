ALTER TABLE workflow_runs
  ADD COLUMN report_message_id uuid,
  ADD COLUMN report_note text;

CREATE UNIQUE INDEX workflow_runs_report_message ON workflow_runs (report_message_id)
  WHERE report_message_id IS NOT NULL;

ALTER TABLE workflow_triggers
  ADD COLUMN quiet_when_clean boolean NOT NULL DEFAULT false;

ALTER TABLE chat_queue DROP CONSTRAINT IF EXISTS chat_queue_origin_check;
ALTER TABLE chat_queue
  ADD CONSTRAINT chat_queue_origin_check
  CHECK (origin IN ('voice', 'assistant', 'pages', 'chat', 'workflow'));
