ALTER TABLE conversations
  ADD COLUMN kind text NOT NULL DEFAULT 'chat' CHECK (kind IN ('chat', 'digest'));

ALTER TABLE runs DROP CONSTRAINT runs_role_check;
ALTER TABLE runs
  ADD CONSTRAINT runs_role_check
    CHECK (role IN ('scout', 'architect', 'builder', 'critic', 'digest'));

CREATE TABLE digests (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  conversation_id uuid REFERENCES conversations (id) ON DELETE SET NULL,
  run_id uuid REFERENCES runs (id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('running', 'ready', 'failed')),
  since timestamptz NOT NULL,
  until timestamptz NOT NULL,
  chat_ids uuid[] NOT NULL DEFAULT '{}',
  body jsonb,
  error text,
  provider text NOT NULL,
  model text,
  model_label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE INDEX digests_workspace_created_idx ON digests (workspace_id, created_at DESC);
