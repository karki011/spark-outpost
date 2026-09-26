ALTER TABLE conversations
  ADD COLUMN provider text,
  ADD COLUMN model text,
  ADD COLUMN effort text,
  ADD COLUMN permission text;

ALTER TABLE runs
  ADD COLUMN model text,
  ADD COLUMN effort text,
  ADD COLUMN context_used integer,
  ADD COLUMN context_size integer,
  ADD COLUMN cost_usd numeric(12, 6);

CREATE TABLE provider_capabilities (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  provider text NOT NULL,
  models jsonb NOT NULL,
  efforts jsonb NOT NULL,
  default_model text,
  captured_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, provider)
);
