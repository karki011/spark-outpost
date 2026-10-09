ALTER TABLE remote_access_settings
  ADD COLUMN can_passkeys boolean NOT NULL DEFAULT true;

CREATE TABLE remote_passkeys (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES remote_devices (id) ON DELETE CASCADE,
  credential_id text NOT NULL UNIQUE CHECK (length(credential_id) BETWEEN 1 AND 1366),
  public_key bytea NOT NULL,
  sign_count bigint NOT NULL DEFAULT 0 CHECK (sign_count >= 0),
  transports text[] NOT NULL DEFAULT '{}',
  synced boolean NOT NULL DEFAULT false,
  label text CHECK (label IS NULL OR length(label) BETWEEN 1 AND 60),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);

CREATE INDEX remote_passkeys_device_idx ON remote_passkeys (device_id, created_at);

CREATE TABLE remote_device_sessions (
  token_hash text PRIMARY KEY CHECK (length(token_hash) = 64),
  device_id uuid NOT NULL REFERENCES remote_devices (id) ON DELETE CASCADE,
  passkey_id uuid NOT NULL REFERENCES remote_passkeys (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX remote_device_sessions_device_idx ON remote_device_sessions (device_id);
