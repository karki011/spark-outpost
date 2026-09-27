ALTER TABLE run_advice DROP CONSTRAINT run_advice_purpose_check;
ALTER TABLE run_advice
  ADD CONSTRAINT run_advice_purpose_check
  CHECK (
    purpose IN (
      'intake', 'route', 'transition', 'parallel', 'build_style', 'watchdog', 'policy', 'verify',
      'scan', 'rank', 'route_shadow'
    )
  );

CREATE VIEW routing_labels AS
SELECT
  r.id AS run_id,
  r.task_id,
  r.conversation_id,
  r.created_at,
  r.status,
  COALESCE(m.content, '') AS request,
  shadow.policy_version,
  shadow.body->'answer'->>'policy' AS policy,
  shadow.body->'answer'->'candidates' AS candidates,
  shadow.body->'answer'->'rule' AS rule_route,
  shadow.body->'answer'->'codePick' AS code_pick,
  shadow.body->'answer'->'tierPick' AS tier_pick,
  shadow.body->'answer'->'variants'->'text' AS jev_text,
  shadow.body->'answer'->'variants'->'evidence' AS jev_evidence,
  builder.pick AS builder_route,
  scan.body->'answer'->>'status' AS scan_status,
  (scan.body->>'latencyMs')::int AS scan_ms,
  rank.body->'answer'->'scanOrder' AS scan_files,
  rank.body->'answer'->'predicted' AS predicted_files,
  rank.body->'answer'->'stageOne' AS rank_stage_one,
  rank.body->'answer'->'stageTwo' AS rank_stage_two,
  (
    SELECT jsonb_agg(f->>'path' ORDER BY f->>'path')
    FROM jsonb_array_elements(COALESCE(o.kept->'files', '[]'::jsonb)) f
  ) AS changed_files,
  checks.checks,
  verify.verdicts AS verify,
  reviews.verdicts AS critic,
  builder.escalated,
  CASE
    WHEN r.reverted_at IS NOT NULL OR sig.reverted THEN 'reverted'
    WHEN sig.kept OR o.kept IS NOT NULL THEN 'kept'
  END AS keep_revert,
  o.rating AS thumbs,
  COALESCE(shadow.jev_input_tokens, 0) + COALESCE(rank.jev_input_tokens, 0) AS jev_tokens,
  COALESCE(shadow.jev_cost_usd, 0) + COALESCE(rank.jev_cost_usd, 0) AS jev_cost_usd
FROM run_advice shadow
JOIN runs r ON r.id = shadow.run_id
LEFT JOIN messages m ON m.id = r.user_message_id
LEFT JOIN task_outcomes o ON o.run_id = r.id
LEFT JOIN LATERAL (
  SELECT a.body, a.jev_input_tokens, a.jev_cost_usd FROM run_advice a
  WHERE a.run_id = r.id AND a.purpose = 'rank' ORDER BY a.created_at DESC LIMIT 1
) rank ON true
LEFT JOIN LATERAL (
  SELECT a.body FROM run_advice a
  WHERE a.run_id = r.id AND a.purpose = 'scan' ORDER BY a.created_at DESC LIMIT 1
) scan ON true
LEFT JOIN LATERAL (
  SELECT
    (array_agg(a.body->'answer'->'pick' ORDER BY a.created_at))[1] AS pick,
    bool_or(a.body->'answer'->>'rule' = 'one tier up') AS escalated
  FROM run_advice a WHERE a.run_id = r.id AND a.purpose = 'route' AND a.role = 'builder'
) builder ON true
LEFT JOIN LATERAL (
  SELECT jsonb_agg(jsonb_build_object(
    'name', src.body->>'name', 'round', src.body->'round', 'status', src.body->>'status'
  ) ORDER BY src.created_at, src.version) AS checks
  FROM run_artifacts src WHERE src.kind = 'check' AND (
    src.source_run_id = r.id
    OR src.source_run_id IN (SELECT ch.id FROM runs ch WHERE ch.parent_run_id = r.id)
  )
) checks ON true
LEFT JOIN LATERAL (
  SELECT jsonb_agg(src.body->>'verdict' ORDER BY src.created_at) AS verdicts
  FROM run_artifacts src WHERE src.kind = 'review' AND (
    src.source_run_id = r.id
    OR src.source_run_id IN (SELECT ch.id FROM runs ch WHERE ch.parent_run_id = r.id)
  )
) reviews ON true
LEFT JOIN LATERAL (
  SELECT jsonb_agg(a.body->'answer'->>'would' ORDER BY a.created_at) AS verdicts
  FROM run_advice a WHERE a.run_id = r.id AND a.purpose = 'verify'
) verify ON true
LEFT JOIN LATERAL (
  SELECT bool_or(s.kind = 'kept') AS kept, bool_or(s.kind = 'reverted') AS reverted
  FROM outcome_signals s WHERE s.run_id = r.id
) sig ON true
WHERE shadow.purpose = 'route_shadow';
