CREATE TABLE tasks (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  CHECK ((status = 'closed') = (closed_at IS NOT NULL))
);

CREATE INDEX tasks_conversation_created_idx ON tasks (conversation_id, created_at);

ALTER TABLE runs
  ADD COLUMN task_id uuid REFERENCES tasks (id) ON DELETE SET NULL,
  ADD COLUMN plan_version integer CHECK (plan_version > 0);

CREATE INDEX runs_task_idx ON runs (task_id, created_at) WHERE task_id IS NOT NULL;

CREATE TABLE run_artifacts (
  task_id uuid NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('plan', 'changes', 'check', 'review', 'advice')),
  version integer NOT NULL CHECK (version > 0),
  body jsonb NOT NULL,
  source_run_id uuid REFERENCES runs (id) ON DELETE SET NULL,
  superseded_by integer CHECK (superseded_by > version),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, kind, version)
);

CREATE TABLE task_links (
  id uuid PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('pr', 'link')),
  url text NOT NULL,
  title text,
  source text NOT NULL CHECK (source IN ('tool_output', 'resource_link', 'agent_text', 'user')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id, url)
);
