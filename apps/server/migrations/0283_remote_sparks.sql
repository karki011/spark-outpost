CREATE TABLE remote_sparks (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  hostname text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_opened_at timestamptz,
  UNIQUE (workspace_id, hostname)
);

ALTER TABLE remote_devices
  ADD COLUMN kind text NOT NULL DEFAULT 'browser' CHECK (kind IN ('browser', 'spark'));
