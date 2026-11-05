ALTER TABLE map_files
  ADD COLUMN kind text NOT NULL DEFAULT 'other'
    CHECK (kind IN ('ui', 'api', 'data', 'test', 'config', 'other')),
  ADD COLUMN last_changed_at timestamptz,
  ADD COLUMN change_count integer NOT NULL DEFAULT 0 CHECK (change_count >= 0),
  ADD COLUMN author_count integer NOT NULL DEFAULT 0 CHECK (author_count >= 0);

ALTER TABLE map_areas ADD COLUMN kind_counts jsonb NOT NULL DEFAULT '{}'::jsonb;
