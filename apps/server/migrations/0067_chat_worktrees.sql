CREATE TABLE chat_worktrees (
  id uuid PRIMARY KEY,
  conversation_id uuid REFERENCES conversations (id) ON DELETE SET NULL,
  project_id uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  repo_root text NOT NULL,
  path text NOT NULL,
  branch text NOT NULL,
  base_branch text,
  base_commit text NOT NULL,
  landed_commit text,
  in_place boolean NOT NULL DEFAULT false,
  owns_branch boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz
);

CREATE UNIQUE INDEX chat_worktrees_live_idx ON chat_worktrees (conversation_id, project_id)
  WHERE removed_at IS NULL;
CREATE INDEX chat_worktrees_path_idx ON chat_worktrees (path) WHERE removed_at IS NULL;

ALTER TABLE conversations
  ADD COLUMN work_place text CHECK (work_place IN ('worktree', 'checkout')),
  ADD COLUMN work_branch text;

ALTER TABLE projects
  ADD COLUMN work_place text NOT NULL DEFAULT 'worktree' CHECK (work_place IN ('worktree', 'checkout'));
