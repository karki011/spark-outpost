CREATE TABLE calendar_connection (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
  connected boolean NOT NULL DEFAULT false,
  before_minutes integer NOT NULL DEFAULT 10 CHECK (before_minutes IN (5, 10, 15)),
  wrap_up_minutes integer NOT NULL DEFAULT 15 CHECK (wrap_up_minutes IN (0, 15, 30)),
  capture boolean NOT NULL DEFAULT true,
  hold_rule text NOT NULL DEFAULT 'focus' CHECK (hold_rule IN ('never', 'focus', 'meetings')),
  focus_names text[] NOT NULL DEFAULT ARRAY['Focus', 'Deep work', 'Heads down'],
  phone_alerts boolean NOT NULL DEFAULT false,
  brief_block boolean NOT NULL DEFAULT true,
  agents_read boolean NOT NULL DEFAULT false,
  notice text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE calendar_calendars (
  key uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  calendar_id text NOT NULL,
  title text NOT NULL,
  source_id text NOT NULL,
  source_title text NOT NULL,
  source_kind text NOT NULL,
  color text NOT NULL,
  writable boolean NOT NULL,
  subscribed boolean NOT NULL,
  ownership text NOT NULL CHECK (ownership IN ('mine', 'shared', 'unknown')),
  include boolean NOT NULL DEFAULT true,
  nudges boolean NOT NULL DEFAULT false,
  busy boolean NOT NULL DEFAULT true,
  position integer NOT NULL DEFAULT 0,
  UNIQUE (workspace_id, calendar_id)
);

CREATE TABLE calendar_marks (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  uid text NOT NULL,
  occurrence_start timestamptz NOT NULL,
  kind text NOT NULL CHECK (kind IN ('remind_5', 'hold')),
  ends_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, uid, occurrence_start, kind)
);
