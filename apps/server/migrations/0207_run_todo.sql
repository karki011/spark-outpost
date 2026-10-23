ALTER TABLE runs ADD COLUMN todo jsonb;

UPDATE runs r SET todo = sent.payload->'content'->'body'->'entries'
FROM (
  SELECT DISTINCT ON (run_id) run_id, payload
  FROM run_events
  WHERE type = 'ACTIVITY_SNAPSHOT' AND payload->>'activityType' = 'plan'
    AND jsonb_typeof(payload->'content'->'body'->'entries') = 'array'
  ORDER BY run_id, seq DESC
) sent
WHERE sent.run_id = r.id;

UPDATE runs r SET todo = latest.body->'entries'
FROM (
  SELECT DISTINCT ON (source_run_id) source_run_id, body
  FROM run_artifacts
  WHERE kind = 'plan' AND source_run_id IS NOT NULL
  ORDER BY source_run_id, version DESC
) latest
WHERE latest.source_run_id = r.id AND r.todo IS NULL;
