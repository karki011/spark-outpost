CREATE TABLE code_index_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  root_path text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('building', 'ready')),
  parser_version text NOT NULL,
  indexed_commit text,
  file_count integer NOT NULL DEFAULT 0 CHECK (file_count >= 0),
  listed_count integer NOT NULL DEFAULT 0 CHECK (listed_count >= 0),
  name_count integer NOT NULL DEFAULT 0 CHECK (name_count >= 0),
  bytes bigint NOT NULL DEFAULT 0 CHECK (bytes >= 0),
  layout jsonb NOT NULL DEFAULT '{}',
  history jsonb NOT NULL DEFAULT '[]',
  history_at timestamptz,
  indexed_at timestamptz,
  last_opened_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX code_index_projects_opened_idx ON code_index_projects (last_opened_at);

CREATE TABLE code_index_names (
  project_id uuid NOT NULL REFERENCES code_index_projects (id) ON DELETE CASCADE,
  id integer NOT NULL,
  name text NOT NULL,
  PRIMARY KEY (project_id, id),
  UNIQUE (project_id, name)
);

CREATE TABLE code_index_files (
  project_id uuid NOT NULL REFERENCES code_index_projects (id) ON DELETE CASCADE,
  path text NOT NULL,
  size integer NOT NULL CHECK (size >= 0),
  mtime_ms bigint NOT NULL,
  content_hash text NOT NULL,
  parser_version text NOT NULL,
  language text NOT NULL,
  package text NOT NULL,
  lines integer NOT NULL CHECK (lines >= 0),
  has_test boolean NOT NULL,
  def_ids integer[] NOT NULL DEFAULT '{}',
  def_kinds smallint[] NOT NULL DEFAULT '{}',
  ref_ids integer[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (project_id, path)
);

CREATE INDEX code_index_files_defs_idx ON code_index_files USING gin (def_ids);
CREATE INDEX code_index_files_refs_idx ON code_index_files USING gin (ref_ids);

ALTER TABLE run_advice DROP CONSTRAINT run_advice_purpose_check;
ALTER TABLE run_advice
  ADD CONSTRAINT run_advice_purpose_check
  CHECK (
    purpose IN (
      'intake', 'route', 'transition', 'parallel', 'build_style', 'watchdog', 'policy', 'verify',
      'scan'
    )
  );
