ALTER TABLE profiles
  ADD COLUMN default_level text NOT NULL DEFAULT 'hands-off'
    CHECK (default_level IN ('balanced', 'hands-off', 'full-auto')),
  ADD COLUMN spend_cap_usd numeric(10, 2) CHECK (spend_cap_usd >= 0),
  ADD COLUMN critic_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN critic_other_provider boolean NOT NULL DEFAULT true,
  ADD COLUMN morning_brief boolean NOT NULL DEFAULT true,
  ADD COLUMN morning_brief_time time NOT NULL DEFAULT '07:00';

INSERT INTO profiles (workspace_id)
SELECT DISTINCT workspace_id FROM provider_connections
ON CONFLICT DO NOTHING;

UPDATE profiles p SET default_level = picked.level
FROM (
  SELECT DISTINCT ON (pc.workspace_id) pc.workspace_id, pc.level
  FROM provider_connections pc
  JOIN profiles owner ON owner.workspace_id = pc.workspace_id
  WHERE pc.disconnected_at IS NULL
  GROUP BY pc.workspace_id, pc.level
  ORDER BY pc.workspace_id, count(*) DESC,
    bool_or(pc.provider = owner.default_provider) DESC, pc.level
) picked
WHERE picked.workspace_id = p.workspace_id;

ALTER TABLE provider_connections DROP COLUMN level;
