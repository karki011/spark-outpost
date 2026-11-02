CREATE FUNCTION run_usage_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify(
    'changes',
    json_build_object(
      'kind', 'usage',
      'conversationId', NEW.conversation_id,
      'runId', NEW.id
    )::text
  )
  FROM conversations c
  WHERE c.id = NEW.conversation_id AND c.kind <> 'digest';
  RETURN NULL;
END
$$;

CREATE TRIGGER runs_usage_change AFTER UPDATE OF context_used, context_size, cost_usd ON runs
  FOR EACH ROW WHEN (
    OLD.context_used IS DISTINCT FROM NEW.context_used
    OR OLD.context_size IS DISTINCT FROM NEW.context_size
    OR OLD.cost_usd IS DISTINCT FROM NEW.cost_usd
  )
  EXECUTE FUNCTION run_usage_changed();
