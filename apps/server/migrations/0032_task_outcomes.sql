CREATE TABLE task_outcomes (
  run_id uuid PRIMARY KEY REFERENCES runs (id) ON DELETE CASCADE,
  task_id uuid REFERENCES tasks (id) ON DELETE SET NULL,
  kind text NOT NULL DEFAULT 'other' CHECK (kind IN ('change', 'answer', 'other')),
  score numeric CHECK (score BETWEEN -1 AND 1),
  verdict text NOT NULL DEFAULT 'unclear'
    CHECK (verdict IN ('good', 'bad', 'mixed', 'unclear')),
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  prompt text CHECK (prompt IN ('mixed', 'sampled')),
  prompt_decided_at timestamptz,
  rating text CHECK (rating IN ('up', 'down')),
  rating_reasons text[] NOT NULL DEFAULT '{}',
  comment text CHECK (char_length(comment) <= 2000),
  rated_at timestamptz,
  kept jsonb,
  commit_checked_at timestamptz,
  settled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (prompt IS NULL OR prompt_decided_at IS NOT NULL),
  CHECK ((rating IS NULL) = (rated_at IS NULL))
);

CREATE INDEX task_outcomes_task_idx ON task_outcomes (task_id) WHERE task_id IS NOT NULL;
CREATE INDEX task_outcomes_unsettled_idx ON task_outcomes (created_at) WHERE settled_at IS NULL;

CREATE TABLE outcome_signals (
  run_id uuid NOT NULL REFERENCES task_outcomes (run_id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (
    kind IN (
      'kept', 'checks_passed', 'quiet_24h', 'committed', 'reverted', 'correction', 're_ask',
      'checks_failed', 'cancelled', 'failed',
      'pr_merged', 'pr_closed', 'pr_reverted', 'pr_review_comments'
    )
  ),
  polarity smallint NOT NULL CHECK (polarity IN (-1, 0, 1)),
  source text NOT NULL
    CHECK (source IN ('user', 'harness', 'git', 'jev', 'heuristic', 'timer', 'pr')),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, kind)
);
