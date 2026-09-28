DROP TRIGGER conversations_insert_change ON conversations;

CREATE TRIGGER conversations_insert_change AFTER INSERT ON conversations
  FOR EACH ROW EXECUTE FUNCTION conversation_row_changed();
CREATE TRIGGER conversations_delete_change AFTER DELETE ON conversations
  FOR EACH ROW WHEN (OLD.kind <> 'digest')
  EXECUTE FUNCTION conversation_row_changed();
