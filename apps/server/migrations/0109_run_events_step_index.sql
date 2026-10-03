CREATE INDEX run_events_steps_idx ON run_events (run_id, seq)
  WHERE type IN ('STEP_STARTED', 'STEP_FINISHED');
