CREATE TABLE member_messages (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
  body text NOT NULL,
  urgency text NOT NULL DEFAULT 'next' CHECK (urgency IN ('next', 'now')),
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'delivered', 'interrupting', 'sent', 'missed', 'continued')),
  delivered_run_id uuid REFERENCES runs (id) ON DELETE SET NULL,
  message_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz
);

CREATE INDEX member_messages_open ON member_messages (run_id) WHERE status = 'queued';
CREATE INDEX member_messages_conversation ON member_messages (conversation_id, created_at);

CREATE TABLE chat_queue (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  position double precision NOT NULL,
  content text NOT NULL,
  continue_run_id uuid REFERENCES runs (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX chat_queue_order ON chat_queue (conversation_id, position);

ALTER TABLE runs DROP CONSTRAINT IF EXISTS runs_start_as_check;
ALTER TABLE runs
  ADD CONSTRAINT runs_start_as_check CHECK (start_as IN ('change', 'continue'));

ALTER TABLE runs DROP CONSTRAINT IF EXISTS runs_source_check;
ALTER TABLE runs
  ADD CONSTRAINT runs_source_check
  CHECK (source IN ('ui', 'e2e', 'bench', 'digest', 'ticket', 'pr_follow_up', 'queue'));
