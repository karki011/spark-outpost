CREATE TABLE crew_builder_chats (
  conversation_id uuid PRIMARY KEY REFERENCES conversations (id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  done_at timestamptz,
  removed_at timestamptz
);

CREATE INDEX crew_builder_chats_workspace ON crew_builder_chats (workspace_id, created_at DESC);
