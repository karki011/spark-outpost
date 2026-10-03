CREATE FUNCTION attention_snapshot_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM notify_change('ticket', NULL, NULL);
  RETURN NULL;
END
$$;

CREATE TRIGGER attention_snapshots_insert_change AFTER INSERT ON attention_snapshots
  FOR EACH ROW EXECUTE FUNCTION attention_snapshot_changed();
CREATE TRIGGER attention_snapshots_update_change AFTER UPDATE ON attention_snapshots
  FOR EACH ROW WHEN (OLD.hash IS DISTINCT FROM NEW.hash)
  EXECUTE FUNCTION attention_snapshot_changed();
