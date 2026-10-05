CREATE TABLE browser_sign_ins (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 60),
  origin text NOT NULL CHECK (length(origin) BETWEEN 1 AND 300),
  keychain_ref text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX browser_sign_ins_label_idx ON browser_sign_ins (project_id, lower(label));
