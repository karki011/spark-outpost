ALTER TABLE workflow_triggers ADD COLUMN update_base boolean NOT NULL DEFAULT false;
ALTER TABLE workflow_runs ADD COLUMN update_base boolean NOT NULL DEFAULT false;
