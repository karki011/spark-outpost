CREATE TABLE conversation_tickets (
  conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL,
  source text NOT NULL,
  ticket_key text NOT NULL,
  state text NOT NULL CHECK (state IN ('linked', 'suggested', 'unlinked')),
  linked_by text NOT NULL CHECK (linked_by IN ('start', 'message', 'user')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, source, ticket_key),
  FOREIGN KEY (workspace_id, source, ticket_key)
    REFERENCES tickets (workspace_id, source, key) ON DELETE CASCADE
);

CREATE INDEX conversation_tickets_ticket_idx
  ON conversation_tickets (workspace_id, source, ticket_key)
  WHERE state = 'linked';
