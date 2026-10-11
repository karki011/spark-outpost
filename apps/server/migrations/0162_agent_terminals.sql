CREATE TABLE agent_terminals (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  run_id uuid REFERENCES runs (id) ON DELETE SET NULL,
  tool_call_id text CHECK (length(tool_call_id) <= 200),
  provider text NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  command text NOT NULL CHECK (length(command) BETWEEN 1 AND 4000),
  cwd text NOT NULL,
  wanted text NOT NULL DEFAULT 'running' CHECK (wanted IN ('running', 'stopped')),
  status text NOT NULL DEFAULT 'starting'
    CHECK (status IN ('starting', 'running', 'exited', 'stopped', 'failed', 'interrupted')),
  exit_code integer,
  pid integer,
  decided_by text NOT NULL CHECK (decided_by IN ('mode', 'card')),
  approval_id uuid REFERENCES approvals (id) ON DELETE SET NULL,
  stopped_by text CHECK (
    stopped_by IN ('user', 'agent', 'turn_stopped', 'quit', 'chat_removed', 'folder_removed')
  ),
  output text NOT NULL DEFAULT '' CHECK (length(output) <= 65536),
  output_chars bigint NOT NULL DEFAULT 0 CHECK (output_chars >= 0),
  text_offset integer CHECK (text_offset >= 0),
  text_before text CHECK (length(text_before) <= 80),
  text_held integer CHECK (text_held >= 0),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
);

CREATE INDEX agent_terminals_conversation_idx
  ON agent_terminals (conversation_id, started_at, id);
CREATE INDEX agent_terminals_live_idx
  ON agent_terminals (workspace_id) WHERE status IN ('starting', 'running');
CREATE UNIQUE INDEX agent_terminals_tool_call_idx
  ON agent_terminals (run_id, tool_call_id) WHERE tool_call_id IS NOT NULL;

CREATE FUNCTION agent_terminal_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM notify_change('agent_terminal', OLD.conversation_id, OLD.run_id);
  ELSE
    PERFORM notify_change('agent_terminal', NEW.conversation_id, NEW.run_id);
  END IF;
  RETURN NULL;
END
$$;

CREATE TRIGGER agent_terminals_change
  AFTER INSERT OR DELETE OR UPDATE OF wanted, status ON agent_terminals
  FOR EACH ROW EXECUTE FUNCTION agent_terminal_changed();
