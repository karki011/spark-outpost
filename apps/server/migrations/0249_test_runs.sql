ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_kind_check;
ALTER TABLE conversations
  ADD CONSTRAINT conversations_kind_check CHECK (kind IN ('chat', 'digest', 'crew'));

ALTER TABLE workflow_runs ADD COLUMN one_spark boolean NOT NULL DEFAULT false;

CREATE TABLE workflow_held_sends (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
  kind text NOT NULL,
  summary text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX workflow_held_sends_run ON workflow_held_sends (run_id, created_at);
