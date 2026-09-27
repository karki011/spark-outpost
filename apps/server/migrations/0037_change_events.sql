CREATE FUNCTION notify_change(change_kind text, change_conversation uuid, change_run uuid)
RETURNS void LANGUAGE sql AS $$
  SELECT pg_notify(
    'changes',
    json_build_object(
      'kind', change_kind, 'conversationId', change_conversation, 'runId', change_run
    )::text
  )
  WHERE change_conversation IS NULL OR NOT EXISTS (
    SELECT 1 FROM conversations c WHERE c.id = change_conversation AND c.kind = 'digest'
  )
$$;

CREATE FUNCTION conversation_row_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM notify_change('conversation', OLD.id, NULL);
  ELSE
    PERFORM notify_change('conversation', NEW.id, NULL);
  END IF;
  RETURN NULL;
END
$$;

CREATE FUNCTION conversation_child_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM notify_change('conversation', OLD.conversation_id, NULL);
  ELSE
    PERFORM notify_change('conversation', NEW.conversation_id, NULL);
  END IF;
  RETURN NULL;
END
$$;

CREATE FUNCTION run_row_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM notify_change('run', NEW.conversation_id, NEW.id);
  RETURN NULL;
END
$$;

CREATE FUNCTION run_child_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM notify_change(TG_ARGV[0], r.conversation_id, r.id) FROM runs r WHERE r.id = NEW.run_id;
  RETURN NULL;
END
$$;

CREATE FUNCTION task_row_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM notify_change('task', NEW.conversation_id, NULL);
  RETURN NULL;
END
$$;

CREATE FUNCTION task_child_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM notify_change('task', t.conversation_id, NULL) FROM tasks t WHERE t.id = NEW.task_id;
  RETURN NULL;
END
$$;

CREATE FUNCTION digest_row_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM notify_change('digest', NULL, NULL);
  RETURN NULL;
END
$$;

CREATE TRIGGER conversations_insert_change AFTER INSERT OR DELETE ON conversations
  FOR EACH ROW EXECUTE FUNCTION conversation_row_changed();
CREATE TRIGGER conversations_update_change AFTER UPDATE ON conversations
  FOR EACH ROW WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION conversation_row_changed();
CREATE TRIGGER messages_change AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION conversation_child_changed();
CREATE TRIGGER conversation_projects_change AFTER INSERT OR DELETE ON conversation_projects
  FOR EACH ROW EXECUTE FUNCTION conversation_child_changed();
CREATE TRIGGER conversation_projects_update_change AFTER UPDATE ON conversation_projects
  FOR EACH ROW WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION conversation_child_changed();

CREATE TRIGGER runs_insert_change AFTER INSERT ON runs
  FOR EACH ROW EXECUTE FUNCTION run_row_changed();
CREATE TRIGGER runs_status_change AFTER UPDATE OF status ON runs
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION run_row_changed();

CREATE TRIGGER run_events_step_change AFTER INSERT ON run_events
  FOR EACH ROW WHEN (NEW.type IN ('STEP_STARTED', 'STEP_FINISHED'))
  EXECUTE FUNCTION run_child_changed('step');
CREATE TRIGGER approvals_insert_change AFTER INSERT ON approvals
  FOR EACH ROW EXECUTE FUNCTION run_child_changed('approval');
CREATE TRIGGER approvals_status_change AFTER UPDATE OF status ON approvals
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION run_child_changed('approval');
CREATE TRIGGER orchestrations_insert_change AFTER INSERT ON orchestrations
  FOR EACH ROW EXECUTE FUNCTION run_child_changed('orchestration');
CREATE TRIGGER orchestrations_update_change AFTER UPDATE ON orchestrations
  FOR EACH ROW WHEN (
    to_jsonb(OLD) - '{active_ms,tool_calls,updated_at}'::text[]
      IS DISTINCT FROM to_jsonb(NEW) - '{active_ms,tool_calls,updated_at}'::text[]
  )
  EXECUTE FUNCTION run_child_changed('orchestration');
CREATE TRIGGER task_outcomes_insert_change AFTER INSERT ON task_outcomes
  FOR EACH ROW EXECUTE FUNCTION run_child_changed('outcome');
CREATE TRIGGER task_outcomes_update_change AFTER UPDATE ON task_outcomes
  FOR EACH ROW WHEN (
    to_jsonb(OLD) - '{updated_at,commit_checked_at,settled_at}'::text[]
      IS DISTINCT FROM to_jsonb(NEW) - '{updated_at,commit_checked_at,settled_at}'::text[]
  )
  EXECUTE FUNCTION run_child_changed('outcome');
CREATE TRIGGER outcome_signals_change AFTER INSERT ON outcome_signals
  FOR EACH ROW EXECUTE FUNCTION run_child_changed('outcome');

CREATE TRIGGER tasks_insert_change AFTER INSERT ON tasks
  FOR EACH ROW EXECUTE FUNCTION task_row_changed();
CREATE TRIGGER tasks_update_change AFTER UPDATE ON tasks
  FOR EACH ROW WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION task_row_changed();
CREATE TRIGGER run_artifacts_insert_change AFTER INSERT ON run_artifacts
  FOR EACH ROW EXECUTE FUNCTION task_child_changed();
CREATE TRIGGER run_artifacts_update_change AFTER UPDATE ON run_artifacts
  FOR EACH ROW WHEN (OLD.superseded_by IS DISTINCT FROM NEW.superseded_by)
  EXECUTE FUNCTION task_child_changed();
CREATE TRIGGER task_links_change AFTER INSERT ON task_links
  FOR EACH ROW EXECUTE FUNCTION task_child_changed();

CREATE TRIGGER digests_insert_change AFTER INSERT ON digests
  FOR EACH ROW EXECUTE FUNCTION digest_row_changed();
CREATE TRIGGER digests_status_change AFTER UPDATE ON digests
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION digest_row_changed();
