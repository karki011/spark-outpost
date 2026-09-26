CREATE TABLE workspaces (
  id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE conversations (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  title text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX conversations_workspace_updated_idx ON conversations (workspace_id, updated_at DESC);

CREATE TABLE messages (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  run_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX messages_conversation_created_idx ON messages (conversation_id, created_at);

CREATE TABLE runs (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  user_message_id uuid NOT NULL UNIQUE REFERENCES messages (id),
  provider text NOT NULL,
  status text NOT NULL CHECK (
    status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'outcome_unknown')
  ),
  error text,
  cancel_requested_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz
);

CREATE INDEX runs_conversation_created_idx ON runs (conversation_id, created_at);

ALTER TABLE messages
  ADD CONSTRAINT messages_run_id_fkey FOREIGN KEY (run_id) REFERENCES runs (id);

CREATE TABLE run_events (
  run_id uuid NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
  seq integer NOT NULL CHECK (seq > 0),
  type text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, seq)
);

CREATE TABLE jobs (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL UNIQUE REFERENCES runs (id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('queued', 'leased', 'done', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  lease_token uuid,
  lease_expires_at timestamptz,
  available_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX jobs_claimable_idx ON jobs (available_at, created_at) WHERE status = 'queued';
CREATE INDEX jobs_lease_expiry_idx ON jobs (lease_expires_at) WHERE status = 'leased';
