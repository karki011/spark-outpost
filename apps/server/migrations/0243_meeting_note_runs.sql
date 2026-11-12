CREATE TABLE meeting_note_runs (
  run_id uuid PRIMARY KEY REFERENCES runs (id) ON DELETE CASCADE
);

DROP INDEX IF EXISTS meetings_event_key;
