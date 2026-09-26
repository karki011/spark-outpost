ALTER TABLE conversations
  ADD COLUMN archived_at timestamptz,
  ADD COLUMN pinned_at timestamptz,
  ADD COLUMN last_read_at timestamptz;

UPDATE conversations SET last_read_at = now();
