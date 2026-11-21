CREATE TABLE sub_chats (
  conversation_id uuid PRIMARY KEY REFERENCES conversations (id) ON DELETE CASCADE,
  parent_conversation_id uuid REFERENCES conversations (id) ON DELETE SET NULL,
  parent_title text NOT NULL,
  position integer NOT NULL,
  task text NOT NULL,
  stacked_on uuid REFERENCES conversations (id) ON DELETE SET NULL,
  starts_after uuid[] NOT NULL DEFAULT '{}',
  started_at timestamptz,
  started_with jsonb NOT NULL,
  approval_id uuid REFERENCES approvals (id) ON DELETE SET NULL,
  task_ask_id uuid,
  report jsonb,
  reported_at timestamptz,
  wrapped_up_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sub_chats_not_own_parent CHECK (parent_conversation_id <> conversation_id),
  CONSTRAINT sub_chats_not_own_stack CHECK (stacked_on <> conversation_id)
);
CREATE INDEX sub_chats_parent ON sub_chats (parent_conversation_id, position);

CREATE TABLE chat_asks (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('task', 'message', 'reply', 'report', 'wrap_up')),
  from_conversation_id uuid REFERENCES conversations (id) ON DELETE SET NULL,
  from_run_id uuid REFERENCES runs (id) ON DELETE SET NULL,
  from_title text NOT NULL,
  to_conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  body text NOT NULL,
  reply_to uuid REFERENCES chat_asks (id) ON DELETE SET NULL,
  state text CHECK (state IN ('waiting', 'replied', 'no_reply')),
  delivered_as text CHECK (delivered_as IN ('turn', 'steer')),
  run_id uuid REFERENCES runs (id) ON DELETE SET NULL,
  no_reply_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz
);
CREATE INDEX chat_asks_to ON chat_asks (to_conversation_id, created_at);
CREATE INDEX chat_asks_from ON chat_asks (from_conversation_id, created_at);
CREATE INDEX chat_asks_undelivered ON chat_asks (created_at) WHERE delivered_as IS NULL;
CREATE INDEX chat_asks_waiting ON chat_asks (run_id) WHERE state = 'waiting';

ALTER TABLE chat_queue DROP CONSTRAINT IF EXISTS chat_queue_origin_check;
ALTER TABLE chat_queue
  ADD CONSTRAINT chat_queue_origin_check CHECK (origin IN ('voice', 'assistant', 'pages', 'chat'));

ALTER TABLE runs DROP CONSTRAINT IF EXISTS runs_source_check;
ALTER TABLE runs
  ADD CONSTRAINT runs_source_check
  CHECK (source IN (
    'ui', 'e2e', 'bench', 'digest', 'ticket', 'pr_follow_up', 'queue', 'slack', 'outpost',
    'agent_cycle', 'spark_rule', 'voice', 'assistant', 'pages', 'workflow', 'chat'
  ));
