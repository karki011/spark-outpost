ALTER TABLE profiles
  ADD COLUMN github_inbox_days smallint NOT NULL DEFAULT 14
    CHECK (github_inbox_days IN (14, 30));

CREATE TABLE github_inbox_seen (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  item_id text NOT NULL CHECK (length(item_id) <= 300),
  head_sha text NOT NULL CHECK (length(head_sha) <= 64),
  seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, item_id)
);
