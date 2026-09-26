ALTER TABLE runs
  ADD COLUMN input_tokens integer,
  ADD COLUMN output_tokens integer,
  ADD COLUMN cached_read_tokens integer,
  ADD COLUMN cached_write_tokens integer,
  ADD COLUMN thought_tokens integer,
  ADD COLUMN total_tokens integer;

CREATE INDEX runs_created_at_idx ON runs (created_at);
