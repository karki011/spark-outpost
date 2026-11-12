CREATE TABLE meetings (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  title text NOT NULL,
  source text NOT NULL CHECK (source IN ('calendar', 'adhoc')),
  event_key text,
  calendar_name text,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  state text NOT NULL DEFAULT 'recording' CHECK (state IN ('recording', 'ended', 'interrupted')),
  goal text NOT NULL DEFAULT '',
  user_notes text NOT NULL DEFAULT '',
  line_count integer NOT NULL DEFAULT 0,
  notes_state text NOT NULL DEFAULT 'none' CHECK (notes_state IN ('none', 'writing', 'ready', 'failed')),
  notes_note text,
  search tsvector GENERATED ALWAYS AS (
    to_tsvector('simple', title || ' ' || goal || ' ' || user_notes)
  ) STORED
);

CREATE INDEX meetings_workspace_started ON meetings (workspace_id, started_at DESC);
CREATE INDEX meetings_event_key ON meetings (workspace_id, event_key) WHERE event_key IS NOT NULL;
CREATE UNIQUE INDEX meetings_one_recording ON meetings (workspace_id) WHERE state = 'recording';
CREATE INDEX meetings_search ON meetings USING gin (search);

CREATE TABLE meeting_lines (
  meeting_id uuid NOT NULL REFERENCES meetings (id) ON DELETE CASCADE,
  seq integer NOT NULL,
  speaker text NOT NULL CHECK (speaker IN ('you', 'others')),
  body text NOT NULL,
  start_ms integer NOT NULL,
  end_ms integer NOT NULL,
  search tsvector GENERATED ALWAYS AS (to_tsvector('simple', body)) STORED,
  PRIMARY KEY (meeting_id, seq)
);

CREATE INDEX meeting_lines_search ON meeting_lines USING gin (search);

CREATE TABLE meeting_notes (
  meeting_id uuid PRIMARY KEY REFERENCES meetings (id) ON DELETE CASCADE,
  markdown text NOT NULL,
  written_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz,
  run_id uuid REFERENCES runs (id) ON DELETE SET NULL,
  search tsvector GENERATED ALWAYS AS (to_tsvector('simple', markdown)) STORED
);

CREATE INDEX meeting_notes_search ON meeting_notes USING gin (search);

CREATE TABLE meeting_attachments (
  meeting_id uuid NOT NULL REFERENCES meetings (id) ON DELETE CASCADE,
  attachment_id uuid NOT NULL REFERENCES attachments (id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  PRIMARY KEY (meeting_id, attachment_id)
);
