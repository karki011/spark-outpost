ALTER TABLE ticket_connections
  ADD COLUMN account_id text,
  ADD COLUMN move_on_merge boolean NOT NULL DEFAULT true;

ALTER TABLE tickets
  ADD COLUMN first_seen_assigned_at timestamptz,
  ADD COLUMN status_since timestamptz;

ALTER TABLE ticket_events DROP CONSTRAINT ticket_events_action_check;
ALTER TABLE ticket_events
  ADD CONSTRAINT ticket_events_action_check CHECK (
    action IN (
      'connect', 'disconnect', 'settings', 'start', 'transition', 'comment', 'link_pr', 'assign'
    )
  );

CREATE TABLE attention_settings (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
  idle_days integer NOT NULL DEFAULT 2 CHECK (idle_days BETWEEN 1 AND 30),
  due_days integer NOT NULL DEFAULT 2 CHECK (due_days BETWEEN 1 AND 30),
  review_days integer NOT NULL DEFAULT 3 CHECK (review_days BETWEEN 1 AND 30),
  brief_enabled boolean NOT NULL DEFAULT true,
  brief_interval_minutes integer NOT NULL DEFAULT 30
    CHECK (brief_interval_minutes IN (0, 15, 30, 60)),
  connect_hint_dismissed boolean NOT NULL DEFAULT false
);

CREATE TABLE attention_snapshots (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
  items jsonb NOT NULL DEFAULT '[]',
  hash text NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE digests
  ADD COLUMN flagged_hash text,
  ADD COLUMN flagged jsonb NOT NULL DEFAULT '[]';
