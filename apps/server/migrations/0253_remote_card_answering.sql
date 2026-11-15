ALTER TABLE remote_access_settings
  ADD COLUMN card_answer_from text NOT NULL DEFAULT 'mac'
    CHECK (card_answer_from IN ('mac', 'devices')),
  ADD COLUMN card_mac_only text[] NOT NULL DEFAULT ARRAY['rules', 'macControl'];

ALTER TABLE approvals
  ADD COLUMN answered_device_id uuid,
  ADD COLUMN answered_device_name text;
