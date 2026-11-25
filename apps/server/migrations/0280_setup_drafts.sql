CREATE TABLE setup_drafts (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  target text NOT NULL,
  fields jsonb NOT NULL DEFAULT '{}',
  conversation_id uuid REFERENCES conversations (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, target)
);
