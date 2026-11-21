ALTER TABLE workflow_runs DROP CONSTRAINT IF EXISTS workflow_runs_source_check;
ALTER TABLE workflow_runs
  ADD CONSTRAINT workflow_runs_source_check
  CHECK (source IN (
    'manual', 'mention', 'schedule', 'catch_up', 'trigger', 'agent', 'github_page', 'github_auto'
  ));

ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS pull_id text CHECK (length(pull_id) <= 300);

UPDATE workflow_runs w
SET pull_id = g.pull_id,
    source = CASE WHEN g.source = 'auto' THEN 'github_auto' ELSE 'github_page' END
FROM github_reviews g
WHERE g.workflow_run_id = w.id AND w.kind = 'review';

CREATE INDEX IF NOT EXISTS workflow_runs_pull ON workflow_runs (workspace_id, started_at)
  WHERE pull_id IS NOT NULL AND kind = 'run';

ALTER TABLE github_reviews DROP CONSTRAINT IF EXISTS github_reviews_source_check;
ALTER TABLE github_reviews
  ADD CONSTRAINT github_reviews_source_check CHECK (source IN ('auto', 'manual', 'elsewhere'));
