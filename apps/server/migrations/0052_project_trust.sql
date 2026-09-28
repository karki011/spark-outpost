CREATE TABLE project_trust (
  project_id uuid PRIMARY KEY REFERENCES projects (id) ON DELETE CASCADE,
  trusted boolean NOT NULL,
  fingerprint text,
  snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  redirects_fingerprint text,
  decided_at timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT trusted OR fingerprint IS NOT NULL)
);

ALTER TABLE agent_config_audit DROP CONSTRAINT agent_config_audit_subject_check;
ALTER TABLE agent_config_audit ADD CONSTRAINT agent_config_audit_subject_check
  CHECK (subject IN ('instructions', 'skills', 'commands', 'subagents', 'hooks', 'mcp', 'trust', 'redirects'));
