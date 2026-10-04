ALTER TABLE projects ADD COLUMN browser_keep_sign_ins boolean NOT NULL DEFAULT true;

ALTER TABLE run_observations DROP CONSTRAINT run_observations_source_check;
ALTER TABLE run_observations
  ADD CONSTRAINT run_observations_source_check CHECK (
    source IN ('secret_file', 'secret_output', 'private_data', 'web_page')
  );

CREATE TABLE browser_screenshots (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  attachment_id uuid NOT NULL REFERENCES attachments (id) ON DELETE CASCADE,
  page text NOT NULL CHECK (length(page) <= 4096),
  title text NOT NULL CHECK (length(title) <= 300),
  width integer NOT NULL CHECK (width > 0),
  height integer NOT NULL CHECK (height > 0),
  sha256 text NOT NULL CHECK (length(sha256) = 64),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX browser_screenshots_conversation_idx
  ON browser_screenshots (conversation_id, created_at);
