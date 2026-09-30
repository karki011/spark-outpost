ALTER TABLE code_index_files
  ADD COLUMN imports text[] NOT NULL DEFAULT '{}',
  ADD COLUMN endpoints jsonb NOT NULL DEFAULT '[]';

CREATE TABLE map_repos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  root_path text NOT NULL UNIQUE,
  rules_version text NOT NULL,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'building', 'paused', 'ready', 'failed')),
  phase text NOT NULL DEFAULT 'index'
    CHECK (phase IN ('index', 'graph', 'labels', 'links', 'done')),
  progress_done integer NOT NULL DEFAULT 0 CHECK (progress_done >= 0),
  progress_total integer NOT NULL DEFAULT 0 CHECK (progress_total >= 0),
  source_signature text,
  built_signature text,
  built_commit text,
  file_count integer NOT NULL DEFAULT 0 CHECK (file_count >= 0),
  area_count integer NOT NULL DEFAULT 0 CHECK (area_count >= 0),
  edge_count integer NOT NULL DEFAULT 0 CHECK (edge_count >= 0),
  timings jsonb NOT NULL DEFAULT '{}',
  error text,
  checked_at timestamptz,
  started_at timestamptz,
  built_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE map_areas (
  repo_id uuid NOT NULL REFERENCES map_repos (id) ON DELETE CASCADE,
  id text NOT NULL,
  root text NOT NULL,
  source text NOT NULL CHECK (source IN ('package', 'folder', 'merged', 'root')),
  package text NOT NULL,
  reason text NOT NULL,
  file_count integer NOT NULL CHECK (file_count >= 0),
  line_count integer NOT NULL CHECK (line_count >= 0),
  fan_in integer NOT NULL CHECK (fan_in >= 0),
  fan_out integer NOT NULL CHECK (fan_out >= 0),
  importance real NOT NULL,
  top_files text[] NOT NULL DEFAULT '{}',
  rule_category text NOT NULL CHECK (rule_category IN ('core', 'shared', 'feature')),
  rule_kind text NOT NULL,
  x real NOT NULL,
  y real NOT NULL,
  radius real NOT NULL,
  PRIMARY KEY (repo_id, id)
);

CREATE TABLE map_files (
  repo_id uuid NOT NULL REFERENCES map_repos (id) ON DELETE CASCADE,
  path text NOT NULL,
  area_id text NOT NULL,
  language text NOT NULL,
  lines integer NOT NULL CHECK (lines >= 0),
  fan_in integer NOT NULL CHECK (fan_in >= 0),
  fan_out integer NOT NULL CHECK (fan_out >= 0),
  importance real NOT NULL,
  reasons text[] NOT NULL DEFAULT '{}',
  x real NOT NULL,
  y real NOT NULL,
  PRIMARY KEY (repo_id, path)
);

CREATE INDEX map_files_area_idx ON map_files (repo_id, area_id, importance DESC);

CREATE TABLE map_edges (
  repo_id uuid NOT NULL REFERENCES map_repos (id) ON DELETE CASCADE,
  from_path text NOT NULL,
  to_path text NOT NULL,
  PRIMARY KEY (repo_id, from_path, to_path)
);

CREATE INDEX map_edges_to_idx ON map_edges (repo_id, to_path);

CREATE TABLE map_area_edges (
  repo_id uuid NOT NULL REFERENCES map_repos (id) ON DELETE CASCADE,
  from_area text NOT NULL,
  to_area text NOT NULL,
  weight integer NOT NULL CHECK (weight > 0),
  PRIMARY KEY (repo_id, from_area, to_area)
);

CREATE TABLE map_labels (
  repo_id uuid NOT NULL REFERENCES map_repos (id) ON DELETE CASCADE,
  area_id text NOT NULL,
  source text NOT NULL CHECK (source IN ('jev', 'rules')),
  category text NOT NULL CHECK (category IN ('core', 'shared', 'feature')),
  kind text NOT NULL,
  name text NOT NULL,
  description text NOT NULL,
  confidence real,
  basis text[] NOT NULL DEFAULT '{}',
  policy_version text NOT NULL,
  labelled_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (repo_id, area_id)
);

CREATE TABLE map_overrides (
  root_path text NOT NULL,
  area_id text NOT NULL,
  category text NOT NULL CHECK (category IN ('core', 'shared', 'feature')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (root_path, area_id)
);

CREATE TABLE map_jev_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id uuid NOT NULL REFERENCES map_repos (id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('area_label', 'link_match')),
  subject text NOT NULL,
  jev_status text NOT NULL
    CHECK (jev_status IN ('answered', 'failed', 'timed_out', 'not_connected')),
  model text,
  input_tokens integer,
  cost_usd numeric(12, 6),
  latency_ms integer,
  policy_version text NOT NULL,
  asked jsonb,
  answer jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX map_jev_calls_repo_idx ON map_jev_calls (repo_id, created_at);

CREATE TABLE map_link_pairs (
  repo_a uuid NOT NULL REFERENCES map_repos (id) ON DELETE CASCADE,
  repo_b uuid NOT NULL REFERENCES map_repos (id) ON DELETE CASCADE,
  signature text NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (repo_a, repo_b),
  CHECK (repo_a < repo_b)
);

CREATE TABLE map_links (
  repo_a uuid NOT NULL,
  repo_b uuid NOT NULL,
  from_repo uuid NOT NULL REFERENCES map_repos (id) ON DELETE CASCADE,
  to_repo uuid NOT NULL REFERENCES map_repos (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('http', 'graphql', 'package', 'env')),
  label text NOT NULL,
  from_path text NOT NULL,
  to_path text NOT NULL,
  from_area text NOT NULL,
  to_area text NOT NULL,
  from_line integer,
  to_line integer,
  confidence real NOT NULL,
  source text NOT NULL CHECK (source IN ('rules', 'jev')),
  PRIMARY KEY (repo_a, repo_b, from_repo, kind, label, from_path, to_path),
  FOREIGN KEY (repo_a, repo_b) REFERENCES map_link_pairs (repo_a, repo_b) ON DELETE CASCADE
);
