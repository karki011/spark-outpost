UPDATE runs SET level = 'hands-off' WHERE level = 'balanced';
ALTER TABLE runs DROP CONSTRAINT IF EXISTS runs_level_check;
ALTER TABLE runs
  ADD CONSTRAINT runs_level_check CHECK (level IN ('hands-off', 'full-auto'));

UPDATE profiles SET default_level = 'hands-off' WHERE default_level = 'balanced';
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_default_level_check;
ALTER TABLE profiles
  ADD CONSTRAINT profiles_default_level_check CHECK (default_level IN ('hands-off', 'full-auto'));

UPDATE teammates SET level = 'hands-off' WHERE level = 'balanced';
ALTER TABLE teammates DROP CONSTRAINT IF EXISTS teammates_level_check;
ALTER TABLE teammates
  ADD CONSTRAINT teammates_level_check CHECK (level IN ('hands-off', 'full-auto'));

UPDATE conversations SET overrides = (
  SELECT COALESCE(
    jsonb_object_agg(
      key,
      CASE WHEN value->>'level' = 'balanced'
        THEN jsonb_set(value, '{level}', '"hands-off"')
        ELSE value END
    ),
    '{}'::jsonb
  )
  FROM jsonb_each(overrides)
)
WHERE jsonb_typeof(overrides) = 'object'
  AND EXISTS (SELECT 1 FROM jsonb_each(overrides) WHERE value->>'level' = 'balanced');
