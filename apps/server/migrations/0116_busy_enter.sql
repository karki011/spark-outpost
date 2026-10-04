ALTER TABLE profiles
  ADD COLUMN busy_enter text NOT NULL DEFAULT 'queue'
  CHECK (busy_enter IN ('queue', 'now'));
