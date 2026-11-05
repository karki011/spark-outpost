CREATE FUNCTION conversation_child_deleted() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM conversations c WHERE c.id = OLD.conversation_id) THEN
    PERFORM notify_change('conversation', OLD.conversation_id, NULL);
  END IF;
  RETURN NULL;
END
$$;

DROP TRIGGER conversation_projects_change ON conversation_projects;

CREATE TRIGGER conversation_projects_insert_change AFTER INSERT ON conversation_projects
  FOR EACH ROW EXECUTE FUNCTION conversation_child_changed();
CREATE TRIGGER conversation_projects_delete_change AFTER DELETE ON conversation_projects
  FOR EACH ROW EXECUTE FUNCTION conversation_child_deleted();
