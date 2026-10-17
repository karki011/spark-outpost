ALTER TABLE runs ADD COLUMN snapshot_end_ref text;

CREATE TABLE run_file_reverts (
  run_id uuid NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
  path text NOT NULL,
  before_blob text,
  after_blob text,
  reverted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, path)
);

ALTER TABLE run_protocol_log DROP CONSTRAINT run_protocol_log_kind_check;
ALTER TABLE run_protocol_log
  ADD CONSTRAINT run_protocol_log_kind_check
  CHECK (kind IN ('request', 'response', 'error', 'notification', 'stderr', 'check', 'ship', 'revert'));
