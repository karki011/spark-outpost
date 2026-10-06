ALTER TABLE browser_screenshots
  ADD COLUMN text_offset integer CHECK (text_offset >= 0),
  ADD COLUMN text_before text CHECK (length(text_before) <= 80),
  ADD COLUMN text_held integer CHECK (text_held >= 0);
