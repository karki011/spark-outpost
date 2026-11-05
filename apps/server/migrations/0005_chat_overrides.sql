ALTER TABLE conversations ADD COLUMN overrides jsonb NOT NULL DEFAULT '{}';

UPDATE conversations
SET overrides = jsonb_build_object(
  provider,
  jsonb_strip_nulls(jsonb_build_object('model', model, 'effort', effort, 'permission', permission))
)
WHERE provider IS NOT NULL;

ALTER TABLE conversations
  DROP COLUMN model,
  DROP COLUMN effort,
  DROP COLUMN permission;
