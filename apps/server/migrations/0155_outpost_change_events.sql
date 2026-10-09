CREATE FUNCTION notify_outpost_changed(changed_outpost uuid) RETURNS void LANGUAGE sql AS $$
  SELECT pg_notify(
    'changes',
    json_build_object(
      'kind', 'outpost_changed', 'conversationId', NULL, 'runId', NULL,
      'outpostId', changed_outpost
    )::text
  )
$$;

CREATE FUNCTION outpost_post_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM notify_outpost_changed(NEW.outpost_id);
  RETURN NULL;
END
$$;

CREATE FUNCTION outpost_run_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM notify_outpost_changed(shown.outpost_id)
  FROM (
    SELECT m.outpost_id FROM outpost_members m WHERE m.conversation_id = NEW.conversation_id
    UNION
    SELECT p.outpost_id FROM outpost_posts p WHERE p.run_id = NEW.id
  ) shown;
  RETURN NULL;
END
$$;

CREATE TRIGGER outpost_posts_insert_change AFTER INSERT ON outpost_posts
  FOR EACH ROW EXECUTE FUNCTION outpost_post_changed();
CREATE TRIGGER outpost_posts_state_change
  AFTER UPDATE OF task_id, run_id, closed_state, pinned_at ON outpost_posts
  FOR EACH ROW WHEN (
    OLD.task_id IS DISTINCT FROM NEW.task_id
    OR OLD.run_id IS DISTINCT FROM NEW.run_id
    OR OLD.closed_state IS DISTINCT FROM NEW.closed_state
    OR OLD.pinned_at IS DISTINCT FROM NEW.pinned_at
  )
  EXECUTE FUNCTION outpost_post_changed();

CREATE TRIGGER runs_insert_outpost_change AFTER INSERT ON runs
  FOR EACH ROW WHEN (NEW.parent_run_id IS NULL)
  EXECUTE FUNCTION outpost_run_changed();
CREATE TRIGGER runs_status_outpost_change AFTER UPDATE OF status ON runs
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.parent_run_id IS NULL)
  EXECUTE FUNCTION outpost_run_changed();
