ALTER TABLE browser_sign_ins
  ADD COLUMN sites text[] NOT NULL DEFAULT '{}' CHECK (cardinality(sites) <= 8),
  ADD COLUMN refused_site text CHECK (refused_site IS NULL OR length(refused_site) BETWEEN 1 AND 300);
