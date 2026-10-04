CREATE TABLE slack_connections (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
  team_id text NOT NULL,
  team_name text NOT NULL,
  team_url text NOT NULL,
  bot_user_id text NOT NULL,
  bot_name text NOT NULL,
  member_id text,
  member_name text,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  problem text,
  problem_at timestamptz,
  validated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE slack_channels (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  channel_id text NOT NULL,
  name text NOT NULL,
  is_private boolean NOT NULL,
  project_id uuid REFERENCES projects (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, channel_id)
);

CREATE TABLE slack_deliveries (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  dedupe_key text NOT NULL,
  kind text NOT NULL,
  conversation_id uuid REFERENCES conversations (id) ON DELETE CASCADE,
  outcome text NOT NULL CHECK (outcome IN ('pending', 'sent', 'skipped', 'failed')),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, dedupe_key)
);

CREATE INDEX slack_deliveries_created_idx ON slack_deliveries (workspace_id, created_at);

CREATE TABLE slack_events (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  action text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('succeeded', 'skipped', 'failed')),
  channel_id text,
  conversation_id uuid REFERENCES conversations (id) ON DELETE SET NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX slack_events_at_idx ON slack_events (workspace_id, at);

CREATE TABLE slack_chat_threads (
  conversation_id uuid PRIMARY KEY REFERENCES conversations (id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  channel_id text NOT NULL,
  thread_ts text NOT NULL,
  permalink text NOT NULL,
  post_updates boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE slack_context_items (
  attachment_id uuid PRIMARY KEY REFERENCES attachments (id) ON DELETE CASCADE,
  channel_id text NOT NULL,
  thread_ts text NOT NULL,
  permalink text NOT NULL
);

ALTER TABLE runs DROP CONSTRAINT IF EXISTS runs_source_check;
ALTER TABLE runs
  ADD CONSTRAINT runs_source_check
  CHECK (source IN ('ui', 'e2e', 'bench', 'digest', 'ticket', 'pr_follow_up', 'queue', 'slack'));
