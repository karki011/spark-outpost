ALTER TABLE provider_connections
  ADD COLUMN summary text,
  ADD COLUMN last_test_at timestamptz,
  ADD COLUMN last_test_ok boolean,
  ADD COLUMN last_test_message text;
