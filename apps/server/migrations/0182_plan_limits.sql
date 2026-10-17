CREATE TABLE provider_plan_limits (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  provider text NOT NULL,
  plan_window text NOT NULL
    CHECK (plan_window IN (
      'five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet', 'seven_day_overage_included'
    )),
  account_label text,
  used double precision NOT NULL CHECK (used >= 0),
  resets_at timestamptz NOT NULL,
  limited boolean NOT NULL,
  observed_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, provider, plan_window)
);

CREATE TABLE provider_extra_usage (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  provider text NOT NULL,
  account_label text,
  status text NOT NULL CHECK (status IN ('allowed', 'allowed_warning', 'rejected')),
  in_use boolean NOT NULL,
  disabled_reason text,
  resets_at timestamptz,
  observed_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, provider)
);
