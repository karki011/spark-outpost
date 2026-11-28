CREATE TABLE cloudflare_reach (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
  hostname text NOT NULL,
  account_id text NOT NULL,
  zone_id text NOT NULL,
  tunnel_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
