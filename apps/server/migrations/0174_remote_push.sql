ALTER TABLE remote_access_settings
  ADD COLUMN can_notifications boolean NOT NULL DEFAULT false;

CREATE TABLE remote_push_subscriptions (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES remote_devices (id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE CHECK (length(endpoint) BETWEEN 1 AND 2048),
  p256dh text NOT NULL CHECK (length(p256dh) BETWEEN 1 AND 200),
  auth text NOT NULL CHECK (length(auth) BETWEEN 1 AND 100),
  hostname text NOT NULL,
  server_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX remote_push_subscriptions_device_idx ON remote_push_subscriptions (device_id);
