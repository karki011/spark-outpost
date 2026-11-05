import type { AnalyticsWindow } from '@spark-outpost/contracts';
import {
  checkFacts,
  modelLabel,
  roleList,
  verdictOf,
  wouldApply,
  type TurnFact,
} from '../analytics/facts.ts';
import type { Queryable } from './db.ts';
import { WINDOW_FILTER, windowParams } from './analytics-window.ts';

interface FactRow {
  id: string;
  day: string;
  project: string;
  category: string;
  retries: number;
  roles: unknown;
  provider: string;
  model: string | null;
  model_label: string | null;
  runs: number;
  tokens: number;
  reported_usd: number;
  estimated_usd: number;
  jev_usd: number;
  verdict: string | null;
  score: number | null;
  kept: boolean | null;
  reverted: boolean | null;
  corrected: boolean | null;
  jev: unknown;
  would_apply: unknown;
  checks: unknown;
}

const SELF_AND_CHILDREN = `(src.source_run_id = t.id
  OR src.source_run_id IN (SELECT ch.id FROM runs ch WHERE ch.parent_run_id = t.id))`;

const FACTS_SQL = `
WITH turns AS (
  SELECT r.* FROM runs r
  JOIN conversations c ON c.id = r.conversation_id
  WHERE c.workspace_id = $1 AND r.parent_run_id IS NULL AND r.role IS DISTINCT FROM 'digest'
    AND ${WINDOW_FILTER}
)
SELECT t.id,
  to_char(t.created_at AT TIME ZONE $4, 'YYYY-MM-DD') AS day,
  COALESCE(p.name, 'No project') AS project,
  COALESCE(t.category, 'unknown') AS category,
  COALESCE(orc.retries, 0) AS retries,
  COALESCE(crew.roles, '{}') AS roles,
  COALESCE(w.provider, t.provider) AS provider,
  COALESCE(w.model, t.used_model, t.model) AS model,
  COALESCE(w.model_label, t.route->>'modelLabel') AS model_label,
  1 + COALESCE(crew.runs, 0) AS runs,
  (COALESCE(t.total_tokens, t.input_tokens + t.output_tokens, 0) + COALESCE(crew.tokens, 0))::int
    AS tokens,
  (CASE WHEN t.cost_source IS DISTINCT FROM 'estimated' THEN COALESCE(t.cost_usd, 0) ELSE 0 END
    + COALESCE(crew.reported, 0))::float8 AS reported_usd,
  (CASE WHEN t.cost_source = 'estimated' THEN COALESCE(t.cost_usd, 0) ELSE 0 END
    + COALESCE(crew.estimated, 0))::float8 AS estimated_usd,
  COALESCE(jev.cost, 0)::float8 AS jev_usd,
  o.verdict, o.score::float8 AS score,
  sig.kept, sig.reverted, sig.corrected,
  a.body->'jev' AS jev, a.body->'wouldApply' AS would_apply,
  ck.checks
FROM turns t
LEFT JOIN conversation_projects cp ON cp.conversation_id = t.conversation_id AND cp.position = 0
LEFT JOIN projects p ON p.id = cp.project_id
LEFT JOIN orchestrations orc ON orc.run_id = t.id
LEFT JOIN task_outcomes o ON o.run_id = t.id
LEFT JOIN run_advice a ON a.run_id = t.id AND a.purpose = 'intake'
LEFT JOIN LATERAL (
  SELECT bool_or(s.kind = 'kept') AS kept, bool_or(s.kind = 'reverted') AS reverted,
    bool_or(s.kind = 'correction') AS corrected
  FROM outcome_signals s WHERE s.run_id = t.id
) sig ON true
LEFT JOIN LATERAL (
  SELECT sum(ad.jev_cost_usd) AS cost FROM run_advice ad WHERE ad.run_id = t.id
) jev ON true
LEFT JOIN LATERAL (
  SELECT array_agg(DISTINCT ch.role) AS roles,
    count(*)::int AS runs,
    sum(COALESCE(ch.total_tokens, ch.input_tokens + ch.output_tokens, 0)) AS tokens,
    sum(ch.cost_usd) FILTER (WHERE ch.cost_source IS DISTINCT FROM 'estimated') AS reported,
    sum(ch.cost_usd) FILTER (WHERE ch.cost_source = 'estimated') AS estimated
  FROM runs ch WHERE ch.parent_run_id = t.id
) crew ON true
LEFT JOIN LATERAL (
  SELECT ch.provider, COALESCE(ch.used_model, ch.model) AS model,
    ch.route->>'modelLabel' AS model_label
  FROM runs ch WHERE ch.parent_run_id = t.id
  ORDER BY (ch.role = 'builder') DESC, ch.created_at DESC
  LIMIT 1
) w ON true
LEFT JOIN LATERAL (
  SELECT jsonb_agg(jsonb_build_object(
    'name', src.body->>'name', 'copy', src.body->>'copy',
    'round', src.body->'round', 'status', src.body->>'status'
  ) ORDER BY src.created_at, src.version) AS checks
  FROM run_artifacts src WHERE src.kind = 'check' AND ${SELF_AND_CHILDREN}
) ck ON true
ORDER BY t.created_at`;

function toFact(row: FactRow): TurnFact {
  return {
    id: row.id,
    day: row.day,
    project: row.project,
    category: row.category,
    retries: row.retries,
    roles: roleList(row.roles),
    provider: row.provider,
    model: row.model ?? 'default',
    modelLabel: modelLabel(row.provider, row.model, row.model_label),
    runs: row.runs,
    tokens: row.tokens,
    reportedUsd: row.reported_usd,
    estimatedUsd: row.estimated_usd,
    jevUsd: row.jev_usd,
    verdict: verdictOf(row.verdict),
    score: row.score,
    kept: row.kept === true,
    reverted: row.reverted === true,
    corrected: row.corrected === true,
    jevAnswered: row.jev !== null && typeof row.jev === 'object',
    wouldApply: wouldApply(row.would_apply),
    checks: checkFacts(row.checks),
  };
}

export async function turnFacts(
  db: Queryable,
  workspaceId: string,
  window: AnalyticsWindow,
): Promise<TurnFact[]> {
  const { rows } = await db.query<FactRow>(FACTS_SQL, windowParams(workspaceId, window));
  return rows.map(toFact);
}
