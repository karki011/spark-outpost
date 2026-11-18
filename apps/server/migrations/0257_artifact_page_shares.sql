CREATE TABLE artifact_page_shares (
  share_id text PRIMARY KEY CHECK (share_id ~ '^[A-Za-z0-9_-]{22}$'),
  artifact_id uuid NOT NULL,
  version integer NOT NULL,
  state text NOT NULL CHECK (state IN ('pending', 'live')),
  url text NOT NULL CHECK (char_length(url) BETWEEN 1 AND 2048),
  expires_at timestamptz NOT NULL,
  has_passcode boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (artifact_id, version)
);
