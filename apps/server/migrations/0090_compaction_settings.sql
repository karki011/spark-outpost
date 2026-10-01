ALTER TABLE profiles
  ADD COLUMN compact_warn_percent integer NOT NULL DEFAULT 60
    CHECK (compact_warn_percent BETWEEN 30 AND 90),
  ADD COLUMN compact_at_percent integer NOT NULL DEFAULT 80
    CHECK (compact_at_percent BETWEEN 40 AND 95),
  ADD COLUMN auto_compact boolean NOT NULL DEFAULT true,
  ADD CONSTRAINT profiles_compact_gap_check
    CHECK (compact_warn_percent + 5 <= compact_at_percent);
