ALTER TABLE runs ADD COLUMN todo jsonb;

UPDATE runs r SET todo = latest.body->'entries'
FROM (
  SELECT DISTINCT ON (source_run_id) source_run_id, body
  FROM run_artifacts
  WHERE kind = 'plan' AND source_run_id IS NOT NULL
  ORDER BY source_run_id, version DESC
) latest
WHERE latest.source_run_id = r.id;
