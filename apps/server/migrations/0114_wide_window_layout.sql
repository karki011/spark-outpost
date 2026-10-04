ALTER TABLE profiles
  ADD COLUMN wide_window text NOT NULL DEFAULT 'rail'
  CHECK (wide_window IN ('rail', 'panel', 'empty'));
