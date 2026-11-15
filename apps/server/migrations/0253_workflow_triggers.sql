ALTER TABLE workflow_runs DROP CONSTRAINT IF EXISTS workflow_runs_source_check;
ALTER TABLE workflow_runs
  ADD CONSTRAINT workflow_runs_source_check
  CHECK (source IN ('manual', 'mention', 'schedule', 'catch_up', 'trigger'));

ALTER TABLE workflow_runs
  ADD COLUMN trigger_kind text
    CHECK (trigger_kind IN ('turn_changed', 'before_publish', 'commit', 'pull_request')),
  ADD COLUMN diff_hash text,
  ADD COLUMN edits boolean NOT NULL DEFAULT false,
  ADD COLUMN gates_run_id uuid REFERENCES runs (id) ON DELETE SET NULL,
  ADD COLUMN blocking integer;

CREATE INDEX workflow_runs_gates ON workflow_runs (gates_run_id) WHERE gates_run_id IS NOT NULL;
CREATE INDEX workflow_runs_chat_trigger
  ON workflow_runs (workspace_id, workflow_id, conversation_id, started_at DESC)
  WHERE source = 'trigger';

CREATE TABLE workflow_triggers (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  workflow_id text NOT NULL,
  turn_changed boolean NOT NULL DEFAULT false,
  before_publish boolean NOT NULL DEFAULT false,
  hold_on_findings boolean NOT NULL DEFAULT false,
  on_commit boolean NOT NULL DEFAULT false,
  branch_glob text NOT NULL DEFAULT '' CHECK (length(branch_glob) <= 200),
  pull_request boolean NOT NULL DEFAULT false,
  project_id uuid,
  debounce_minutes integer NOT NULL DEFAULT 0 CHECK (debounce_minutes BETWEEN 0 AND 1440),
  edits boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, workflow_id)
);

CREATE TABLE workflow_trigger_events (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  workflow_id text NOT NULL,
  conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('turn_changed', 'commit', 'pull_request')),
  state text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'claimed', 'started', 'skipped', 'not_started')),
  reason text CHECK (reason IN ('unchanged', 'problem', 'chat_gone', 'error')),
  detail text,
  due_at timestamptz NOT NULL,
  message_id uuid,
  claimed_at timestamptz,
  workflow_run_id uuid REFERENCES workflow_runs (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, workflow_id)
    REFERENCES workflow_triggers (workspace_id, workflow_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX workflow_trigger_events_pending
  ON workflow_trigger_events (workspace_id, workflow_id, conversation_id)
  WHERE state = 'pending';
CREATE INDEX workflow_trigger_events_due ON workflow_trigger_events (due_at)
  WHERE state = 'pending';
CREATE INDEX workflow_trigger_events_recent
  ON workflow_trigger_events (workspace_id, workflow_id, updated_at DESC);

CREATE TABLE workflow_trigger_marks (
  workspace_id uuid NOT NULL,
  workflow_id text NOT NULL,
  mark text NOT NULL CHECK (length(mark) <= 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, workflow_id, mark),
  FOREIGN KEY (workspace_id, workflow_id)
    REFERENCES workflow_triggers (workspace_id, workflow_id) ON DELETE CASCADE
);

CREATE TABLE chat_branch_tips (
  conversation_id uuid PRIMARY KEY REFERENCES conversations (id) ON DELETE CASCADE,
  branch text,
  tip text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workflow_publish_holds (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  workflow_id text NOT NULL,
  workflow_run_id uuid REFERENCES workflow_runs (id) ON DELETE SET NULL,
  diff_hash text NOT NULL,
  findings integer NOT NULL CHECK (findings >= 0),
  finished boolean NOT NULL,
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'released', 'cleared')),
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz
);

CREATE UNIQUE INDEX workflow_publish_holds_open
  ON workflow_publish_holds (conversation_id, workflow_id) WHERE state = 'open';
CREATE INDEX workflow_publish_holds_workflow
  ON workflow_publish_holds (workspace_id, workflow_id, created_at DESC);
