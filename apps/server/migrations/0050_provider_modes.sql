ALTER TABLE provider_connections ADD COLUMN agent_mode text;

UPDATE provider_connections SET agent_mode = CASE
  WHEN permission IS DISTINCT FROM 'do' THEN
    CASE provider WHEN 'codex' THEN 'read-only' ELSE 'plan' END
  WHEN level = 'full-auto' THEN
    CASE provider WHEN 'codex' THEN 'agent' ELSE 'bypassPermissions' END
  WHEN level = 'hands-off' THEN
    CASE provider WHEN 'codex' THEN 'agent' ELSE 'acceptEdits' END
  ELSE
    CASE provider WHEN 'codex' THEN 'ask-every-action' ELSE 'default' END
END;

ALTER TABLE provider_connections ALTER COLUMN level SET DEFAULT 'hands-off';

UPDATE conversations SET overrides = (
  SELECT COALESCE(
    jsonb_object_agg(
      key,
      CASE WHEN value ? 'permission' OR value ? 'level' THEN
        (value - 'permission') || jsonb_build_object(
          'agentMode',
          CASE
            WHEN COALESCE(value->>'permission', pc.permission) IS DISTINCT FROM 'do' THEN
              CASE key WHEN 'codex' THEN 'read-only' ELSE 'plan' END
            WHEN COALESCE(value->>'level', pc.level) = 'full-auto' THEN
              CASE key WHEN 'codex' THEN 'agent' ELSE 'bypassPermissions' END
            WHEN COALESCE(value->>'level', pc.level) = 'hands-off' THEN
              CASE key WHEN 'codex' THEN 'agent' ELSE 'acceptEdits' END
            ELSE
              CASE key WHEN 'codex' THEN 'ask-every-action' ELSE 'default' END
          END
        )
      ELSE value END
    ),
    '{}'::jsonb
  )
  FROM jsonb_each(overrides)
  LEFT JOIN provider_connections pc
    ON pc.workspace_id = conversations.workspace_id AND pc.provider = key
)
WHERE jsonb_typeof(overrides) = 'object'
  AND EXISTS (
    SELECT 1 FROM jsonb_each(overrides)
    WHERE value ? 'permission' OR value ? 'level'
  );

ALTER TABLE runs ADD COLUMN agent_mode text;
ALTER TABLE runs ADD COLUMN requested_mode text;
ALTER TABLE runs ADD COLUMN config_values jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE provider_capabilities ADD COLUMN modes jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE provider_capabilities ADD COLUMN default_mode text;
ALTER TABLE provider_capabilities ADD COLUMN config_options jsonb NOT NULL DEFAULT '[]'::jsonb;
