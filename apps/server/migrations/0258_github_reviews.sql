ALTER TABLE workflow_runs DROP CONSTRAINT workflow_runs_kind_check;
ALTER TABLE workflow_runs
  ADD CONSTRAINT workflow_runs_kind_check CHECK (kind IN ('run', 'test', 'review'));

CREATE TABLE github_review_settings (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
  reviewer_kind text CHECK (reviewer_kind IN ('spark', 'workflow')),
  reviewer_id text CHECK (length(reviewer_id) <= 200),
  auto_review boolean NOT NULL DEFAULT false,
  may_post boolean NOT NULL DEFAULT false,
  may_approve boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((reviewer_kind IS NULL) = (reviewer_id IS NULL)),
  CHECK (NOT auto_review OR reviewer_kind IS NOT NULL),
  CHECK (NOT may_approve OR may_post)
);

CREATE TABLE github_reviews (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  pull_id text NOT NULL CHECK (length(pull_id) <= 300),
  pull_key text NOT NULL CHECK (pull_key = lower(pull_id)),
  head_sha text NOT NULL CHECK (length(head_sha) <= 64),
  reviewer_kind text NOT NULL CHECK (reviewer_kind IN ('spark', 'workflow')),
  reviewer_id text NOT NULL CHECK (length(reviewer_id) <= 200),
  reviewer_name text NOT NULL,
  source text NOT NULL CHECK (source IN ('auto', 'manual')),
  state text NOT NULL DEFAULT 'queued'
    CHECK (state IN ('queued', 'running', 'done', 'failed', 'stopped')),
  due_at timestamptz NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  stop_requested_at timestamptz,
  material text,
  body text,
  error text CHECK (length(error) <= 2000),
  workflow_run_id uuid REFERENCES workflow_runs (id) ON DELETE SET NULL,
  conversation_id uuid REFERENCES conversations (id) ON DELETE SET NULL,
  cost_usd numeric,
  tokens bigint
);

CREATE UNIQUE INDEX github_reviews_one_queued
  ON github_reviews (workspace_id, pull_key) WHERE state = 'queued';
CREATE UNIQUE INDEX github_reviews_one_running
  ON github_reviews (workspace_id, pull_key) WHERE state = 'running';
CREATE INDEX github_reviews_pull ON github_reviews (workspace_id, pull_key, requested_at DESC);
CREATE INDEX github_reviews_workflow_run ON github_reviews (workflow_run_id);

CREATE TABLE github_review_posts (
  id uuid PRIMARY KEY,
  review_id uuid NOT NULL REFERENCES github_reviews (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('comment', 'approve')),
  github_id text,
  url text,
  posted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX github_review_posts_review ON github_review_posts (review_id, posted_at);
