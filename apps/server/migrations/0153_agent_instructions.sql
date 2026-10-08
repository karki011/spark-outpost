ALTER TABLE profiles
  ADD COLUMN agent_instructions text NOT NULL DEFAULT '',
  ADD COLUMN agent_instructions_file text NOT NULL DEFAULT '';
