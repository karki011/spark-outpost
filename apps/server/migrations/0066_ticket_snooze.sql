ALTER TABLE tickets
  ADD COLUMN snoozed_until timestamptz,
  ADD COLUMN snoozed_rules text[] NOT NULL DEFAULT '{}';
