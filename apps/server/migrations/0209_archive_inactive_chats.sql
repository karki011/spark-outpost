ALTER TABLE profiles
  ADD COLUMN archive_inactive_days integer DEFAULT 2
  CONSTRAINT profiles_archive_inactive_days CHECK (archive_inactive_days IN (2, 7, 30));

ALTER TABLE conversations
  ADD COLUMN restored_at timestamptz,
  ADD COLUMN auto_archived_days integer
  CONSTRAINT conversations_auto_archived_days CHECK (auto_archived_days > 0);
