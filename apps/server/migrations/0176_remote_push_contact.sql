ALTER TABLE remote_access_settings
  ADD COLUMN push_contact text CHECK (length(push_contact) BETWEEN 1 AND 200),
  ADD COLUMN push_contact_changed_at timestamptz;
