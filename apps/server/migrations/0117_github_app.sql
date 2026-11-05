CREATE TABLE github_app_connections (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
  login text NOT NULL,
  state text NOT NULL DEFAULT 'connected' CHECK (state IN ('connected', 'needs_sign_in')),
  generation integer NOT NULL DEFAULT 1,
  access_expires_at timestamptz,
  refresh_expires_at timestamptz,
  repos jsonb NOT NULL DEFAULT '[]',
  repos_truncated boolean NOT NULL DEFAULT false,
  checked_at timestamptz NOT NULL DEFAULT now(),
  signed_in_at timestamptz NOT NULL DEFAULT now()
);
