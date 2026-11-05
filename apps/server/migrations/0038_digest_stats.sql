ALTER TABLE digests ADD COLUMN stats jsonb NOT NULL DEFAULT '{}'::jsonb;
