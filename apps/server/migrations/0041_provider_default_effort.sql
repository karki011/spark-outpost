ALTER TABLE provider_connections ALTER COLUMN effort DROP NOT NULL;

UPDATE provider_connections SET effort = 'medium';
