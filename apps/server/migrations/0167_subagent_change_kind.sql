DROP TRIGGER run_events_subagent_change ON run_events;

CREATE TRIGGER run_events_subagent_change AFTER INSERT ON run_events
  FOR EACH ROW WHEN (NEW.type IN ('SUBAGENT_STARTED', 'SUBAGENT_FINISHED', 'SUBAGENT_ERROR'))
  EXECUTE FUNCTION run_child_changed('subagent');

CREATE TRIGGER run_events_subagent_wait_change AFTER INSERT ON run_events
  FOR EACH ROW WHEN (
    NEW.type = 'ACTIVITY_SNAPSHOT' AND NEW.payload->>'activityType' = 'subagents'
  )
  EXECUTE FUNCTION run_child_changed('step');
