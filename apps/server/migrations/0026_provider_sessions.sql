CREATE TABLE provider_sessions (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  provider text NOT NULL,
  agent_key text NOT NULL,
  session_id text NOT NULL,
  cwd text NOT NULL,
  workdir text,
  additional_dirs text[] NOT NULL DEFAULT '{}',
  settings_hash text NOT NULL,
  last_message_id uuid,
  last_reply_hash text,
  reported_cost_usd numeric(12, 6),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  close_reason text,
  CHECK ((closed_at IS NULL) = (close_reason IS NULL))
);

CREATE UNIQUE INDEX provider_sessions_open_key
  ON provider_sessions (conversation_id, agent_key) WHERE closed_at IS NULL;

CREATE INDEX provider_sessions_latest
  ON provider_sessions (conversation_id, agent_key, created_at DESC);

CREATE INDEX provider_sessions_open_lru
  ON provider_sessions (last_used_at) WHERE closed_at IS NULL;
