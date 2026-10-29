CREATE INDEX IF NOT EXISTS messages_run_created_idx ON messages (run_id, created_at)
  WHERE run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS run_events_step_activity_idx ON run_events (run_id, seq)
  WHERE type IN ('STEP_STARTED', 'STEP_FINISHED', 'REASONING_START');
DROP INDEX IF EXISTS run_events_steps_idx;
