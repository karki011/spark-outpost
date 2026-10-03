CREATE TABLE jev_answer_cache (
  key text PRIMARY KEY,
  answers jsonb NOT NULL,
  model text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX jev_answer_cache_created_idx ON jev_answer_cache (created_at);

ALTER TABLE map_jev_calls ADD COLUMN from_cache boolean NOT NULL DEFAULT false;
