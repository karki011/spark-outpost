CREATE TABLE rail_flags (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  tool_call_id text,
  rail text NOT NULL,
  title text NOT NULL,
  paths jsonb NOT NULL DEFAULT '[]'::jsonb,
  inside boolean NOT NULL,
  originals jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'dismissed', 'reverted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);

CREATE INDEX rail_flags_conversation_idx ON rail_flags (conversation_id, created_at);
CREATE INDEX rail_flags_open_idx ON rail_flags (conversation_id) WHERE status = 'open';

CREATE TRIGGER rail_flags_change AFTER INSERT OR UPDATE ON rail_flags
  FOR EACH ROW EXECUTE FUNCTION conversation_child_changed();
