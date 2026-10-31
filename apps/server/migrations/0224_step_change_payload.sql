CREATE FUNCTION run_step_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  step_name text := NEW.payload->>'stepName';
  named boolean := length(COALESCE(step_name, '')) <= 1000;
BEGIN
  PERFORM pg_notify(
    'changes',
    json_strip_nulls(json_build_object(
      'kind', 'step',
      'conversationId', r.conversation_id,
      'runId', r.id,
      'phase', CASE
        WHEN NOT named THEN NULL
        WHEN NEW.type = 'STEP_STARTED' THEN 'started'
        ELSE 'finished'
      END,
      'step', CASE
        WHEN named AND NEW.type = 'STEP_STARTED' AND NOT (NEW.payload ? 'subagentRunId')
          THEN step_name
      END
    ))::text
  )
  FROM runs r
  JOIN conversations c ON c.id = r.conversation_id
  WHERE r.id = NEW.run_id AND c.kind <> 'digest';
  RETURN NULL;
END
$$;

DROP TRIGGER run_events_step_change ON run_events;

CREATE TRIGGER run_events_step_change AFTER INSERT ON run_events
  FOR EACH ROW WHEN (NEW.type IN ('STEP_STARTED', 'STEP_FINISHED'))
  EXECUTE FUNCTION run_step_changed();
