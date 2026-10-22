ALTER TABLE calendar_connection
  ALTER COLUMN agents_read DROP NOT NULL,
  ALTER COLUMN agents_read DROP DEFAULT;
