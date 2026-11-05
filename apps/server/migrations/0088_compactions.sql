ALTER TABLE provider_sessions
  ADD COLUMN context_used integer,
  ADD COLUMN context_size integer,
  ADD COLUMN compact_snoozed boolean NOT NULL DEFAULT false;

CREATE TABLE compactions (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  run_id uuid REFERENCES runs (id) ON DELETE SET NULL,
  session_row_id uuid REFERENCES provider_sessions (id) ON DELETE SET NULL,
  agent_key text,
  method text NOT NULL CHECK (method IN ('agent', 'spark', 'agent-auto')),
  tokens_before integer,
  tokens_after integer,
  context_size integer,
  summary text,
  last_message_id uuid REFERENCES messages (id) ON DELETE SET NULL,
  from_conversation_id uuid REFERENCES conversations (id) ON DELETE SET NULL,
  from_run_id uuid REFERENCES runs (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX compactions_conversation_idx ON compactions (conversation_id, created_at);
CREATE INDEX compactions_from_conversation_idx ON compactions (from_conversation_id)
  WHERE from_conversation_id IS NOT NULL;

ALTER TABLE approvals DROP CONSTRAINT approvals_kind_check;
ALTER TABLE approvals ADD CONSTRAINT approvals_kind_check CHECK (
  kind IN (
    'edit', 'execute', 'other', 'spark_action', 'clarify', 'plan', 'retry', 'accept', 'budget',
    'merge_conflict', 'stuck', 'verify', 'pieces', 'ownership', 'pr_split', 'compact'
  )
);
