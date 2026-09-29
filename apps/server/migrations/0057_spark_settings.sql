ALTER TABLE profiles
  ADD COLUMN personality text NOT NULL DEFAULT 'friendly'
    CHECK (personality IN ('playful', 'friendly', 'facts')),
  ADD COLUMN spark_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN team_mode boolean NOT NULL DEFAULT true,
  ADD COLUMN use_name boolean NOT NULL DEFAULT true;
