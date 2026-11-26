ALTER TABLE remote_access_settings
  ADD COLUMN reach text NOT NULL DEFAULT 'tailscale' CHECK (reach IN ('tailscale', 'custom'));
