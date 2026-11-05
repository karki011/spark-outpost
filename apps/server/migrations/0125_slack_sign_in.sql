ALTER TABLE slack_connections
  ADD COLUMN method text NOT NULL DEFAULT 'own_app' CHECK (method IN ('own_app', 'sign_in')),
  ADD COLUMN state text NOT NULL DEFAULT 'connected' CHECK (state IN ('connected', 'needs_sign_in')),
  ADD COLUMN generation integer NOT NULL DEFAULT 1,
  ADD COLUMN access_expires_at timestamptz,
  ADD COLUMN refresh_expires_at timestamptz;
