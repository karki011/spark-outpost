CREATE TABLE user_plugin_trust (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  plugin_key text NOT NULL,
  enabled boolean NOT NULL,
  fingerprint text,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  decided_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, plugin_key),
  CHECK (NOT enabled OR fingerprint IS NOT NULL)
);

ALTER TABLE agent_config_audit DROP CONSTRAINT agent_config_audit_subject_check;
ALTER TABLE agent_config_audit ADD CONSTRAINT agent_config_audit_subject_check
  CHECK (subject IN ('instructions', 'skills', 'commands', 'subagents', 'hooks', 'mcp', 'trust', 'redirects', 'user-plugin'));
