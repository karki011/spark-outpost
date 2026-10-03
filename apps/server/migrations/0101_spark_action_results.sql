DROP TRIGGER IF EXISTS approvals_status_change ON approvals;
CREATE TRIGGER approvals_status_change AFTER UPDATE OF status, payload ON approvals
  FOR EACH ROW WHEN (
    OLD.status IS DISTINCT FROM NEW.status
    OR OLD.payload->'sparkResult' IS DISTINCT FROM NEW.payload->'sparkResult'
  )
  EXECUTE FUNCTION run_child_changed('approval');

CREATE INDEX IF NOT EXISTS approvals_spark_results_idx
  ON approvals ((payload->'sparkResult'->>'state'))
  WHERE kind = 'spark_action' AND payload ? 'sparkResult';
