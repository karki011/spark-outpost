CREATE INDEX run_events_sub_chats_started_idx ON run_events (run_id, seq)
  WHERE type = 'ACTIVITY_SNAPSHOT' AND payload->>'activityType' = 'sub_chats_started';

CREATE FUNCTION run_signalled() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('run_signals', NEW.id::text);
  RETURN NULL;
END
$$;

CREATE TRIGGER runs_signalled AFTER UPDATE OF cancel_requested_at, requested_mode ON runs
  FOR EACH ROW WHEN (
    NEW.cancel_requested_at IS DISTINCT FROM OLD.cancel_requested_at
    OR NEW.requested_mode IS DISTINCT FROM OLD.requested_mode
  )
  EXECUTE FUNCTION run_signalled();
