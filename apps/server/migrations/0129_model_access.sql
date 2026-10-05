CREATE TABLE provider_model_access (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  provider text NOT NULL,
  method text NOT NULL CHECK (method IN ('cli', 'api_key')),
  account_kind text,
  account_label text,
  account_plan text,
  listed jsonb NOT NULL DEFAULT '[]'::jsonb,
  unlisted jsonb NOT NULL DEFAULT '[]'::jsonb,
  rejected jsonb NOT NULL DEFAULT '[]'::jsonb,
  reported_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, provider)
);

ALTER TABLE runs
  ADD COLUMN model_switch jsonb,
  ADD COLUMN error_details text;
