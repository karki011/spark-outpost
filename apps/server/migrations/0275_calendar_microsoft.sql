CREATE TABLE calendar_microsoft_accounts (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  subject text NOT NULL,
  email text NOT NULL,
  needs_sign_in boolean NOT NULL DEFAULT false,
  can_edit boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, subject)
);

ALTER TABLE calendar_calendars
  ADD COLUMN microsoft_account_id uuid
    REFERENCES calendar_microsoft_accounts (id) ON DELETE CASCADE;
