CREATE INDEX IF NOT EXISTS messages_run_created_idx ON messages (run_id, created_at)
  WHERE run_id IS NOT NULL;
