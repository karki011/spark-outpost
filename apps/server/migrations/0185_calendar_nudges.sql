UPDATE calendar_calendars SET nudges = true;

ALTER TABLE calendar_calendars ALTER COLUMN nudges SET DEFAULT true;

ALTER TABLE calendar_calendars DROP COLUMN busy;
