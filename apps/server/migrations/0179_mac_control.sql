ALTER TABLE profiles ADD COLUMN mac_control boolean NOT NULL DEFAULT false;

ALTER TABLE runs ADD COLUMN remote_device_id uuid;

CREATE TABLE remote_messages (
  message_id uuid PRIMARY KEY,
  device_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE conversations
  ADD COLUMN remote_typed_device_id uuid,
  ADD COLUMN remote_typed_at timestamptz;

ALTER TABLE run_observations DROP CONSTRAINT run_observations_source_check;
ALTER TABLE run_observations
  ADD CONSTRAINT run_observations_source_check CHECK (
    source IN ('secret_file', 'secret_output', 'private_data', 'web_page', 'mac_app')
  );
