CREATE TABLE user_plugin_reviews (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  plugin_key text NOT NULL,
  fingerprint text NOT NULL,
  run_id uuid REFERENCES runs (id) ON DELETE SET NULL,
  findings jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  PRIMARY KEY (workspace_id, plugin_key, fingerprint)
);

CREATE INDEX user_plugin_reviews_run_idx ON user_plugin_reviews (run_id);
