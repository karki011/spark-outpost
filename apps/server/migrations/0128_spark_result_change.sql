CREATE TRIGGER approvals_spark_result_change AFTER UPDATE OF payload ON approvals
  FOR EACH ROW WHEN (OLD.payload->'sparkResult' IS DISTINCT FROM NEW.payload->'sparkResult')
  EXECUTE FUNCTION run_child_changed('approval');
