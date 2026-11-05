ALTER TABLE calendar_connection ALTER COLUMN alert_lead SET DEFAULT 0;

UPDATE calendar_connection SET alert_lead = 0 WHERE alert_lead = 1;
