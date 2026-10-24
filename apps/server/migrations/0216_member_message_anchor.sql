ALTER TABLE member_messages
  ADD COLUMN IF NOT EXISTS delivered_text_offset integer,
  ADD COLUMN IF NOT EXISTS delivered_text_before text,
  ADD COLUMN IF NOT EXISTS delivered_text_held integer;
