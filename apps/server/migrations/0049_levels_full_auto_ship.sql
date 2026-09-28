-- Hands-on is gone: its chats, defaults and runs read as Balanced ("Ask before edits").
UPDATE provider_connections SET level = 'balanced' WHERE level = 'hands-on';
ALTER TABLE provider_connections DROP CONSTRAINT IF EXISTS provider_connections_level_check;
ALTER TABLE provider_connections
  ADD CONSTRAINT provider_connections_level_check
  CHECK (level IN ('balanced', 'hands-off', 'full-auto'));

UPDATE runs SET level = 'balanced' WHERE level = 'hands-on';
ALTER TABLE runs DROP CONSTRAINT IF EXISTS runs_level_check;
ALTER TABLE runs
  ADD CONSTRAINT runs_level_check CHECK (level IN ('balanced', 'hands-off', 'full-auto'));

UPDATE conversations SET overrides = (
  SELECT COALESCE(
    jsonb_object_agg(
      key,
      CASE WHEN value->>'level' = 'hands-on'
        THEN jsonb_set(value, '{level}', '"balanced"')
        ELSE value END
    ),
    '{}'::jsonb
  )
  FROM jsonb_each(overrides)
)
WHERE jsonb_typeof(overrides) = 'object'
  AND EXISTS (SELECT 1 FROM jsonb_each(overrides) WHERE value->>'level' = 'hands-on');

-- Full auto opens a draft PR even when checks still fail, unless this is turned off.
ALTER TABLE profiles ADD COLUMN ship_failing_checks boolean NOT NULL DEFAULT true;

-- A Full auto ship commits on its branch without switching the user's checkout.
ALTER TABLE task_ships ADD COLUMN keeps_checkout boolean NOT NULL DEFAULT false;
