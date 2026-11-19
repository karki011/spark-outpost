ALTER TABLE remote_access_settings ADD COLUMN can_notify_away_only boolean NOT NULL DEFAULT true;
UPDATE remote_access_settings SET can_notify_away_only = false WHERE can_notifications;
