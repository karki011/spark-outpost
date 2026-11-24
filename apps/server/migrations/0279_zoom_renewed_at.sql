ALTER TABLE zoom_accounts
  ADD COLUMN IF NOT EXISTS renewed_at timestamptz NOT NULL DEFAULT now();
