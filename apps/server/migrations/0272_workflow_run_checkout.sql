ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS checkout_path text;
ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS checkout_root text;
ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS checkout_main text;

CREATE INDEX IF NOT EXISTS workflow_runs_checkout ON workflow_runs (status)
  WHERE checkout_path IS NOT NULL;
