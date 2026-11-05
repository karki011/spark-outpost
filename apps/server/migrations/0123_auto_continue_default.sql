ALTER TABLE profiles ALTER COLUMN auto_continue_seconds SET DEFAULT 60;

UPDATE profiles SET auto_continue_seconds = 60 WHERE auto_continue_seconds = 10;
