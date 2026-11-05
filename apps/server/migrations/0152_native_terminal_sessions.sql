ALTER TABLE conversations ADD COLUMN session_type text NOT NULL DEFAULT 'chat'
  CHECK (session_type IN ('chat', 'terminal'));
ALTER TABLE conversations ADD COLUMN terminal_provider text
  CHECK (terminal_provider IN ('claude', 'codex'));

CREATE TABLE native_terminal_sessions (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL UNIQUE REFERENCES conversations(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('claude', 'codex')),
  state text NOT NULL CHECK (state IN ('starting', 'working', 'waiting_for_permission',
    'waiting_for_input', 'ready', 'exited', 'error', 'unknown', 'interrupted')),
  cwd text NOT NULL,
  label text NOT NULL,
  native_session_id text,
  native_turn_id text,
  active_run_id uuid REFERENCES runs(id) ON DELETE SET NULL,
  launch_message_id uuid REFERENCES messages(id) ON DELETE SET NULL,
  generation integer NOT NULL DEFAULT 1,
  observation text NOT NULL DEFAULT 'unsupported' CHECK (observation IN ('hooks', 'unsupported')),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE native_terminal_events (
  session_id uuid NOT NULL REFERENCES native_terminal_sessions(id) ON DELETE CASCADE,
  generation integer NOT NULL,
  event_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, generation, event_id)
);
