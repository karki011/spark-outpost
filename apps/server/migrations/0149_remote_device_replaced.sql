ALTER TABLE remote_devices
  ADD COLUMN replaced_by uuid REFERENCES remote_devices (id) ON DELETE SET NULL;
