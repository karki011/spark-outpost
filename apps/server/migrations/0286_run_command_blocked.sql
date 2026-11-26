ALTER TABLE run_commands DROP CONSTRAINT IF EXISTS run_commands_status_check;
ALTER TABLE run_commands
  ADD CONSTRAINT run_commands_status_check
  CHECK (status IN ('running', 'completed', 'failed', 'blocked', 'interrupted'));

UPDATE run_commands
SET status = 'blocked'
WHERE status = 'failed'
  AND exit_code IS NULL
  AND output ~ '^\s*(<tool_use_error>)?Blocked: ';
