CREATE INDEX run_events_subagents_idx ON run_events (run_id, seq)
  WHERE type IN ('SUBAGENT_STARTED', 'SUBAGENT_FINISHED', 'SUBAGENT_ERROR');

CREATE INDEX run_events_subagent_wait_idx ON run_events (run_id, seq)
  WHERE type = 'ACTIVITY_SNAPSHOT' AND payload->>'activityType' = 'subagents';

CREATE TRIGGER run_events_subagent_change AFTER INSERT ON run_events
  FOR EACH ROW WHEN (
    NEW.type IN ('SUBAGENT_STARTED', 'SUBAGENT_FINISHED', 'SUBAGENT_ERROR')
    OR (NEW.type = 'ACTIVITY_SNAPSHOT' AND NEW.payload->>'activityType' = 'subagents')
  )
  EXECUTE FUNCTION run_child_changed('step');
