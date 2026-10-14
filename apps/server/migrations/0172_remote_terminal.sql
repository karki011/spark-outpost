ALTER TABLE remote_access_settings
  ADD COLUMN can_terminal boolean NOT NULL DEFAULT false,
  ADD COLUMN can_terminal_approve boolean NOT NULL DEFAULT false;
