ALTER TABLE profiles ADD COLUMN default_level_notice boolean NOT NULL DEFAULT false;

UPDATE conversations c
SET overrides = c.overrides || pinned.levels
FROM (
  SELECT chat.id,
    jsonb_object_agg(
      provider.id,
      COALESCE(chat.overrides -> provider.id, '{}'::jsonb) || '{"level": "hands-off"}'::jsonb
    ) AS levels
  FROM conversations chat
  CROSS JOIN unnest(ARRAY['claude', 'codex', 'zai']) AS provider(id)
  WHERE NOT (COALESCE(chat.overrides -> provider.id, '{}'::jsonb) ? 'level')
    AND NOT EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.workspace_id = chat.workspace_id AND p.default_level <> 'hands-off'
    )
  GROUP BY chat.id
) pinned
WHERE pinned.id = c.id;

UPDATE profiles
SET default_level = 'full-auto',
    default_level_notice = onboarding_completed_at IS NOT NULL
WHERE default_level = 'hands-off';

ALTER TABLE profiles ALTER COLUMN default_level SET DEFAULT 'full-auto';
