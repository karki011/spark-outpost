CREATE TABLE zoom_accounts (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
  subject text NOT NULL,
  email text NOT NULL,
  needs_sign_in boolean NOT NULL DEFAULT false,
  renewed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
