CREATE TABLE projects (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  name text NOT NULL,
  root_path text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, root_path)
);

ALTER TABLE conversations
  ADD COLUMN project_id uuid REFERENCES projects (id) ON DELETE SET NULL;

CREATE INDEX conversations_project_idx ON conversations (project_id);

ALTER TABLE attachments ADD COLUMN source_path text;
