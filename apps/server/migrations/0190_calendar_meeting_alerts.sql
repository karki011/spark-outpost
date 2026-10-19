ALTER TABLE calendar_connection
  ADD COLUMN alert_style text NOT NULL DEFAULT 'center' CHECK (alert_style IN ('center', 'bubble')),
  ADD COLUMN alert_lead integer NOT NULL DEFAULT 1 CHECK (alert_lead IN (0, 1, 5)),
  ADD COLUMN auto_join boolean NOT NULL DEFAULT false;
