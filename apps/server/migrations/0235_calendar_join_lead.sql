ALTER TABLE calendar_connection
  ADD COLUMN join_lead integer NOT NULL DEFAULT 10 CHECK (join_lead IN (0, 2, 5, 10));
