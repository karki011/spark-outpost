CREATE TABLE outposts (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  paused_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX outposts_workspace ON outposts (workspace_id, created_at);

CREATE TABLE outpost_members (
  outpost_id uuid NOT NULL REFERENCES outposts (id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  handle text NOT NULL CHECK (handle ~ '^[a-z][a-z0-9-]{1,15}$' AND handle <> 'all'),
  position double precision NOT NULL,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (outpost_id, conversation_id),
  CONSTRAINT outpost_members_one_outpost UNIQUE (conversation_id),
  CONSTRAINT outpost_members_handle UNIQUE (outpost_id, handle)
);

CREATE TABLE outpost_posts (
  id uuid PRIMARY KEY,
  outpost_id uuid NOT NULL REFERENCES outposts (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('request', 'note', 'notice')),
  body text NOT NULL,
  from_user boolean NOT NULL DEFAULT false,
  from_conversation_id uuid REFERENCES conversations (id) ON DELETE SET NULL,
  from_run_id uuid REFERENCES runs (id) ON DELETE SET NULL,
  request_hash text,
  waits boolean NOT NULL DEFAULT false,
  from_handle text,
  to_handle text,
  to_conversation_id uuid REFERENCES conversations (id) ON DELETE SET NULL,
  guest boolean NOT NULL DEFAULT false,
  batch_id uuid,
  task_id uuid,
  run_id uuid REFERENCES runs (id) ON DELETE SET NULL,
  closed_state text CHECK (closed_state IN ('cancelled', 'failed', 'rejected')),
  closed_reason text,
  closed_at timestamptz,
  observed jsonb NOT NULL DEFAULT '[]',
  answer_seen_at timestamptz,
  pinned_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT outpost_posts_task UNIQUE (task_id),
  CONSTRAINT outpost_posts_agent_ask UNIQUE (from_run_id, to_conversation_id, request_hash),
  CONSTRAINT outpost_posts_request_handle CHECK (kind <> 'request' OR to_handle IS NOT NULL),
  CONSTRAINT outpost_posts_closed CHECK ((closed_state IS NULL) = (closed_at IS NULL)),
  CONSTRAINT outpost_posts_pinned_note CHECK (pinned_at IS NULL OR kind = 'note')
);

CREATE INDEX outpost_posts_thread ON outpost_posts (outpost_id, created_at, id);
CREATE INDEX outpost_posts_unsent ON outpost_posts (created_at, id)
  WHERE kind = 'request' AND task_id IS NULL AND closed_state IS NULL;
CREATE INDEX outpost_posts_run ON outpost_posts (run_id) WHERE run_id IS NOT NULL;
CREATE INDEX outpost_posts_to ON outpost_posts (to_conversation_id, created_at)
  WHERE to_conversation_id IS NOT NULL;
CREATE INDEX outpost_posts_from ON outpost_posts (from_conversation_id, created_at)
  WHERE from_conversation_id IS NOT NULL;

ALTER TABLE chat_queue
  ADD COLUMN outpost_post_id uuid REFERENCES outpost_posts (id) ON DELETE CASCADE;

CREATE UNIQUE INDEX chat_queue_outpost_post ON chat_queue (outpost_post_id)
  WHERE outpost_post_id IS NOT NULL;

ALTER TABLE runs DROP CONSTRAINT IF EXISTS runs_source_check;
ALTER TABLE runs
  ADD CONSTRAINT runs_source_check
  CHECK (source IN ('ui', 'e2e', 'bench', 'digest', 'ticket', 'pr_follow_up', 'queue', 'slack', 'outpost'));
