CREATE TABLE week_recaps (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES conversations (id) ON DELETE SET NULL,
  run_id uuid REFERENCES runs (id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('running', 'ready', 'failed')),
  week_start date NOT NULL,
  since timestamptz NOT NULL,
  until timestamptz NOT NULL,
  facts jsonb NOT NULL,
  body jsonb,
  error text,
  provider text NOT NULL,
  model text,
  model_label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE INDEX week_recaps_workspace_created_idx ON week_recaps (workspace_id, created_at DESC);
CREATE UNIQUE INDEX week_recaps_one_running_idx ON week_recaps (workspace_id)
  WHERE status = 'running';

ALTER TABLE profiles
  ADD COLUMN week_recap boolean NOT NULL DEFAULT true,
  ADD COLUMN week_recap_day smallint NOT NULL DEFAULT 5 CHECK (week_recap_day BETWEEN 1 AND 7),
  ADD COLUMN week_recap_time time NOT NULL DEFAULT '15:00',
  ADD COLUMN week_recap_tried_on date;

CREATE TABLE week_recap_refines (
  id uuid PRIMARY KEY,
  recap_id uuid NOT NULL REFERENCES week_recaps (id) ON DELETE CASCADE,
  run_id uuid REFERENCES runs (id) ON DELETE SET NULL,
  voice text NOT NULL CHECK (voice IN ('me', 'manager')),
  instruction text NOT NULL,
  text_in text NOT NULL,
  text_out text,
  status text NOT NULL CHECK (status IN ('running', 'ready', 'failed')),
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE INDEX week_recap_refines_recap_idx ON week_recap_refines (recap_id, created_at DESC);
CREATE UNIQUE INDEX week_recap_refines_one_running_idx ON week_recap_refines (recap_id)
  WHERE status = 'running';
