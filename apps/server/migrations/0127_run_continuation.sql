ALTER TABLE runs
  ADD COLUMN continues_run_id uuid REFERENCES runs (id) ON DELETE SET NULL,
  ADD COLUMN interruption_choice text CHECK (interruption_choice IN ('continue', 'fresh')),
  ADD COLUMN interruption_chosen_at timestamptz;

CREATE UNIQUE INDEX runs_continues_run_idx ON runs (continues_run_id)
  WHERE continues_run_id IS NOT NULL;
