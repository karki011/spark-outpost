ALTER TABLE projects ADD COLUMN check_commands text[];

ALTER TABLE run_protocol_log DROP CONSTRAINT run_protocol_log_direction_check;
ALTER TABLE run_protocol_log
  ADD CONSTRAINT run_protocol_log_direction_check
  CHECK (direction IN ('to_agent', 'from_agent', 'harness'));

ALTER TABLE run_protocol_log DROP CONSTRAINT run_protocol_log_kind_check;
ALTER TABLE run_protocol_log
  ADD CONSTRAINT run_protocol_log_kind_check
  CHECK (kind IN ('request', 'response', 'error', 'notification', 'stderr', 'check'));
