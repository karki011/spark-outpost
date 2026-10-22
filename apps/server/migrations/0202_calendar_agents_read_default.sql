ALTER TABLE calendar_connection
  ALTER COLUMN agents_read DROP NOT NULL,
  ALTER COLUMN agents_read DROP DEFAULT;

UPDATE calendar_connection SET agents_read = NULL WHERE agents_read = false;
