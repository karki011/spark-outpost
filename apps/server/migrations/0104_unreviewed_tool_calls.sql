ALTER TABLE run_protocol_log ADD COLUMN unreviewed boolean NOT NULL DEFAULT false;

CREATE INDEX run_protocol_log_unreviewed_idx ON run_protocol_log (run_id) WHERE unreviewed;
