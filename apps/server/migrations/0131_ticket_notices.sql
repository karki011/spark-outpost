ALTER TABLE tickets
  ADD COLUMN dismissed_flags text[] NOT NULL DEFAULT '{}',
  ADD COLUMN notice_seen text;
