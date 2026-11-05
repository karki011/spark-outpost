ALTER TABLE remote_access_settings
  ALTER COLUMN can_sign_ins SET DEFAULT true,
  ALTER COLUMN can_reset SET DEFAULT true,
  ADD COLUMN serve_target text CHECK (serve_target IS NULL OR length(serve_target) BETWEEN 1 AND 200);

UPDATE remote_access_settings
SET can_sign_ins = true, can_reset = true
WHERE can_settings AND can_connections AND can_projects AND can_agent_mode AND can_high_risk_cards
  AND NOT can_sign_ins AND NOT can_reset AND NOT can_devices;
