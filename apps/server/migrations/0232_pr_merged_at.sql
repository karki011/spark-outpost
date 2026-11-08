ALTER TABLE pr_watches ADD COLUMN merged_at timestamptz;

UPDATE pr_watches SET merged_at = updated_at WHERE pr_state = 'merged';

CREATE FUNCTION pr_watch_merged_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.pr_state = 'merged' AND NEW.merged_at IS NULL THEN
    NEW.merged_at := now();
  ELSIF NEW.pr_state <> 'merged' THEN
    NEW.merged_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER pr_watches_merged_at BEFORE INSERT OR UPDATE OF pr_state ON pr_watches
  FOR EACH ROW EXECUTE FUNCTION pr_watch_merged_at();
