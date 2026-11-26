CREATE TABLE cloudflare_connections (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
  origin text NOT NULL,
  share_artifacts boolean NOT NULL DEFAULT true,
  checked_at timestamptz,
  problem text,
  created_at timestamptz NOT NULL DEFAULT now()
);
