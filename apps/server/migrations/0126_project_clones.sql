CREATE TABLE project_clones (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  source text NOT NULL,
  destination text NOT NULL,
  dir_dev text NOT NULL,
  dir_ino text NOT NULL,
  pid integer,
  started_at timestamptz NOT NULL DEFAULT now()
);
