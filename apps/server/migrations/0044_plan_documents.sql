CREATE TABLE plan_documents (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  task_id uuid REFERENCES tasks (id) ON DELETE SET NULL,
  version integer NOT NULL CHECK (version > 0),
  status text NOT NULL CHECK (status IN ('proposed', 'approved', 'rejected', 'superseded')),
  source text NOT NULL CHECK (source IN ('claude_plan_mode', 'codex', 'chat', 'user')),
  body text NOT NULL CHECK (length(body) > 0),
  source_run_id uuid REFERENCES runs (id) ON DELETE SET NULL,
  source_message_id uuid REFERENCES messages (id) ON DELETE SET NULL,
  tool_call_id text,
  approval_id uuid REFERENCES approvals (id) ON DELETE SET NULL,
  approved_at timestamptz,
  approved_by text CHECK (approved_by IN ('user', 'jev')),
  approved_option text,
  approved_run_id uuid REFERENCES runs (id) ON DELETE SET NULL,
  approved_commit text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, version),
  CHECK (status <> 'approved' OR approved_at IS NOT NULL)
);

CREATE INDEX plan_documents_approved_idx
  ON plan_documents (conversation_id, approved_at DESC)
  WHERE status = 'approved';

ALTER TABLE run_advice DROP CONSTRAINT run_advice_purpose_check;
ALTER TABLE run_advice
  ADD CONSTRAINT run_advice_purpose_check
  CHECK (
    purpose IN (
      'intake', 'route', 'transition', 'parallel', 'build_style', 'watchdog', 'policy', 'verify',
      'scan', 'rank', 'route_shadow', 'plan_agreed'
    )
  );
