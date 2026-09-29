CREATE TABLE piece_lists (
  id uuid PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  orchestration_run_id uuid NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  plan_document_id uuid REFERENCES plan_documents (id) ON DELETE SET NULL,
  plan_version integer,
  pieces_hash text NOT NULL,
  placement text NOT NULL CHECK (placement IN ('in_order', 'shared', 'worktree')),
  placement_reason text NOT NULL,
  integration text,
  status text NOT NULL CHECK (status IN ('proposed', 'approved', 'superseded', 'rejected')),
  approval_id uuid REFERENCES approvals (id) ON DELETE SET NULL,
  approved_by text CHECK (approved_by IN ('user', 'level')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id, version)
);

CREATE INDEX piece_lists_run_idx ON piece_lists (orchestration_run_id);

CREATE TABLE task_pieces (
  id uuid PRIMARY KEY,
  piece_list_id uuid NOT NULL REFERENCES piece_lists (id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position >= 0),
  key text NOT NULL,
  title text NOT NULL,
  goal text NOT NULL,
  owns text[] NOT NULL,
  reads text[] NOT NULL DEFAULT '{}',
  depends_on text[] NOT NULL DEFAULT '{}',
  contract text,
  contract_version integer NOT NULL DEFAULT 1,
  acceptance text[] NOT NULL DEFAULT '{}',
  checks text[] NOT NULL DEFAULT '{}',
  research boolean NOT NULL DEFAULT false,
  size_estimate integer NOT NULL,
  placement text NOT NULL CHECK (placement IN ('in_order', 'shared', 'worktree', 'read_only')),
  provider text,
  model text,
  builder_run_id uuid REFERENCES runs (id) ON DELETE SET NULL,
  worktree_id uuid REFERENCES run_worktrees (run_id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('pending', 'ready', 'running', 'landed', 'skipped', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  fix_turns integer NOT NULL DEFAULT 0,
  files_changed text[] NOT NULL DEFAULT '{}',
  violations jsonb NOT NULL DEFAULT '[]',
  check_status text CHECK (check_status IN ('passed', 'failed', 'none')),
  landed_at timestamptz,
  note text,
  UNIQUE (piece_list_id, key)
);

CREATE TABLE piece_notes (
  id uuid PRIMARY KEY,
  piece_id uuid NOT NULL REFERENCES task_pieces (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (
    kind IN ('merge_main', 'contract_changed', 'requirement_added', 'skip', 'stop', 'reassign', 'steer')
  ),
  body text NOT NULL,
  source text NOT NULL CHECK (source IN ('user', 'coordinator')),
  urgent boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  delivered_run_id uuid REFERENCES runs (id) ON DELETE SET NULL
);

ALTER TABLE runs DROP CONSTRAINT runs_role_check;
ALTER TABLE runs
  ADD CONSTRAINT runs_role_check CHECK (
    role IN ('scout', 'architect', 'builder', 'critic', 'digest', 'coordinator', 'integrator')
  );

ALTER TABLE run_advice DROP CONSTRAINT run_advice_role_check;
ALTER TABLE run_advice
  ADD CONSTRAINT run_advice_role_check CHECK (
    role IN ('scout', 'architect', 'builder', 'critic', 'coordinator', 'integrator')
  );

ALTER TABLE approvals DROP CONSTRAINT approvals_kind_check;
ALTER TABLE approvals ADD CONSTRAINT approvals_kind_check CHECK (
  kind IN (
    'edit', 'execute', 'other', 'clarify', 'plan', 'retry', 'accept', 'budget', 'merge_conflict',
    'stuck', 'verify', 'pieces', 'ownership'
  )
);

ALTER TABLE projects
  ADD COLUMN builder_env jsonb,
  ADD COLUMN stable_checkout boolean NOT NULL DEFAULT false;
