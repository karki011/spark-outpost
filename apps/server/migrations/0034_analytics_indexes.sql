CREATE INDEX run_artifacts_source_run_idx ON run_artifacts (source_run_id, kind)
  WHERE source_run_id IS NOT NULL;

CREATE INDEX runs_top_level_created_idx ON runs (created_at)
  WHERE parent_run_id IS NULL;
