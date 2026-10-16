ALTER TABLE profiles
  ADD COLUMN assistant_provider text,
  ADD COLUMN assistant_model_choice text NOT NULL DEFAULT 'fast'
    CHECK (assistant_model_choice IN ('fast', 'default', 'pick')),
  ADD COLUMN assistant_model text,
  ADD COLUMN assistant_effort text,
  ADD COLUMN assistant_applied text,
  ADD COLUMN assistant_notice text,
  ADD COLUMN assistant_history_from timestamptz;

CREATE TABLE assistant_facts (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  text text NOT NULL,
  message_id uuid REFERENCES messages (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, text)
);

CREATE TABLE assistant_events (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  run_id uuid REFERENCES runs (id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN (
    'session_started', 'session_resumed', 'session_reseeded', 'compacted_threshold',
    'compacted_idle', 'settings_changed', 'fact_added', 'fact_removed', 'history_cleared'
  )),
  detail text,
  audited boolean NOT NULL DEFAULT false,
  at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX assistant_events_workspace ON assistant_events (workspace_id, at);
