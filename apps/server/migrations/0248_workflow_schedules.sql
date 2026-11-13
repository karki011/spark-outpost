CREATE TABLE workflow_schedules (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  workflow_id text NOT NULL,
  enabled boolean NOT NULL,
  every integer NOT NULL CHECK (every BETWEEN 1 AND 1000),
  unit text NOT NULL CHECK (unit IN ('minutes', 'hours', 'days', 'weeks')),
  days smallint[] NOT NULL DEFAULT '{}',
  from_time text NOT NULL DEFAULT '00:00',
  to_time text,
  anchor text NOT NULL,
  project_id uuid,
  message text NOT NULL DEFAULT '',
  missed text NOT NULL DEFAULT 'run_once' CHECK (missed IN ('run_once', 'skip')),
  conversation_id uuid REFERENCES conversations (id) ON DELETE SET NULL,
  last_checked_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, workflow_id)
);

CREATE INDEX workflow_schedules_chat ON workflow_schedules (conversation_id)
  WHERE conversation_id IS NOT NULL;

CREATE TABLE workflow_schedule_slots (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  workflow_id text NOT NULL,
  slot_at timestamptz NOT NULL,
  last_slot_at timestamptz NOT NULL,
  state text NOT NULL
    CHECK (state IN ('claimed', 'started', 'skipped', 'held', 'not_started')),
  reason text
    CHECK (reason IN ('previous_running', 'missed', 'paused', 'problem', 'project_gone', 'error')),
  detail text,
  source text NOT NULL CHECK (source IN ('schedule', 'catch_up')),
  message_id uuid NOT NULL,
  workflow_run_id uuid REFERENCES workflow_runs (id) ON DELETE SET NULL,
  claimed_at timestamptz NOT NULL,
  released_at timestamptz,
  FOREIGN KEY (workspace_id, workflow_id)
    REFERENCES workflow_schedules (workspace_id, workflow_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX workflow_schedule_slots_claim
  ON workflow_schedule_slots (workspace_id, workflow_id, slot_at)
  WHERE state IN ('claimed', 'started');

CREATE INDEX workflow_schedule_slots_recent
  ON workflow_schedule_slots (workspace_id, workflow_id, last_slot_at DESC);
