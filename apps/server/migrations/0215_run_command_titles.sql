ALTER TABLE run_commands
  ADD COLUMN description text CHECK (length(description) <= 4000),
  ADD COLUMN tool_call_id text CHECK (length(tool_call_id) <= 4000);
