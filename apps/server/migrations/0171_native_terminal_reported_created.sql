ALTER TABLE native_terminal_reported_usage
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
