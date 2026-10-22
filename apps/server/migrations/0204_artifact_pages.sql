CREATE TABLE artifact_pages (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('html', 'markdown', 'svg')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX artifact_pages_conversation ON artifact_pages (conversation_id, created_at);

CREATE TABLE artifact_page_versions (
  artifact_id uuid NOT NULL REFERENCES artifact_pages (id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  bytes integer NOT NULL CHECK (bytes BETWEEN 0 AND 2097152),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  view_key text NOT NULL UNIQUE CHECK (view_key ~ '^[0-9a-f]{64}$'),
  run_id uuid REFERENCES runs (id) ON DELETE SET NULL,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (artifact_id, version)
);

ALTER TABLE remote_access_settings ADD COLUMN can_artifacts boolean NOT NULL DEFAULT false;
