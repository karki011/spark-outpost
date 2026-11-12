CREATE TABLE meeting_note_runs (
  run_id uuid PRIMARY KEY REFERENCES runs (id) ON DELETE CASCADE,
  meeting_id uuid NOT NULL REFERENCES meetings (id) ON DELETE CASCADE
);

CREATE INDEX meeting_note_runs_meeting ON meeting_note_runs (meeting_id);

DROP INDEX IF EXISTS meetings_event_key;
