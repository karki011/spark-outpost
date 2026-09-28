import type { AnalyticsWindow, SpendDay, SpendLeaf } from '@spark-outpost/contracts';
import { modelLabel } from '../analytics/facts.ts';
import type { SessionRun } from '../analytics/resume.ts';
import { groupBy, roundTo } from '../analytics/tally.ts';
import type { Queryable } from './db.ts';
import { WINDOW_FILTER, windowParams } from './analytics-window.ts';

const WORKSPACE_RUNS = `FROM runs r JOIN conversations c ON c.id = r.conversation_id
  WHERE c.workspace_id = $1 AND ${WINDOW_FILTER}`;

interface LeafRow {
  project: string;
  provider: string;
  model: string | null;
  model_label: string | null;
  runs: number;
  reported_usd: number;
  estimated_usd: number;
  unpriced: number;
}

export interface SpendLeaves {
  leaves: SpendLeaf[];
  unpricedRuns: number;
}

function mergeLeaves(rows: readonly LeafRow[]): SpendLeaf[] {
  const labelled = rows.map((row) => ({
    ...row,
    label: modelLabel(row.provider, row.model, row.model_label),
  }));
  const groups = groupBy(labelled, (row) => [row.project, row.provider, row.label].join('\u0000'));
  return [...groups.values()]
    .map((group) => {
      const first = group[0]!;
      const reported = group.reduce((sum, row) => sum + row.reported_usd, 0);
      const estimated = group.reduce((sum, row) => sum + row.estimated_usd, 0);
      return {
        project: first.project,
        provider: first.provider,
        model: first.model ?? 'default',
        modelLabel: first.label,
        runs: group.reduce((sum, row) => sum + row.runs, 0),
        costUsd: roundTo(reported + estimated, 6),
        reportedUsd: roundTo(reported, 6),
        estimatedUsd: roundTo(estimated, 6),
      };
    })
    .filter((leaf) => leaf.costUsd > 0)
    .sort((a, b) => b.costUsd - a.costUsd);
}

export async function spendLeaves(
  db: Queryable,
  workspaceId: string,
  window: AnalyticsWindow,
): Promise<SpendLeaves> {
  const { rows } = await db.query<LeafRow>(
    `SELECT COALESCE(p.name, 'No project') AS project, r.provider,
       COALESCE(r.used_model, r.model) AS model, r.route->>'modelLabel' AS model_label,
       count(*)::int AS runs,
       COALESCE(sum(r.cost_usd) FILTER (WHERE r.cost_source IS DISTINCT FROM 'estimated'), 0)::float8
         AS reported_usd,
       COALESCE(sum(r.cost_usd) FILTER (WHERE r.cost_source = 'estimated'), 0)::float8
         AS estimated_usd,
       count(*) FILTER (WHERE r.cost_usd IS NULL AND r.status = 'succeeded'
         AND NOT EXISTS (SELECT 1 FROM runs ch WHERE ch.parent_run_id = r.id))::int AS unpriced
     FROM runs r JOIN conversations c ON c.id = r.conversation_id
     LEFT JOIN conversation_projects cp ON cp.conversation_id = c.id AND cp.position = 0
     LEFT JOIN projects p ON p.id = cp.project_id
     WHERE c.workspace_id = $1 AND ${WINDOW_FILTER}
     GROUP BY 1, 2, 3, 4`,
    windowParams(workspaceId, window),
  );
  return {
    leaves: mergeLeaves(rows),
    unpricedRuns: rows.reduce((sum, row) => sum + row.unpriced, 0),
  };
}

interface DayRow {
  day: string;
  runs: number;
  reported_usd: number;
  estimated_usd: number;
}

export interface DailySpend extends SpendDay {
  runs: number;
}

export async function dailySpend(
  db: Queryable,
  workspaceId: string,
  window: AnalyticsWindow,
): Promise<DailySpend[]> {
  const { rows } = await db.query<DayRow>(
    `SELECT day, count(*) FILTER (WHERE agent)::int AS runs,
       COALESCE(sum(cost) FILTER (WHERE NOT estimated), 0)::float8 AS reported_usd,
       COALESCE(sum(cost) FILTER (WHERE estimated), 0)::float8 AS estimated_usd
     FROM (
       SELECT to_char(r.created_at AT TIME ZONE $4, 'YYYY-MM-DD') AS day, true AS agent,
         r.cost_usd AS cost, r.cost_source = 'estimated' AS estimated
       ${WORKSPACE_RUNS}
       UNION ALL
       SELECT to_char(r.created_at AT TIME ZONE $4, 'YYYY-MM-DD'), false, a.jev_cost_usd, true
       FROM run_advice a JOIN runs r ON r.id = a.run_id
       JOIN conversations c ON c.id = r.conversation_id
       WHERE c.workspace_id = $1 AND ${WINDOW_FILTER} AND a.jev_cost_usd IS NOT NULL
     ) spend
     GROUP BY day ORDER BY day`,
    windowParams(workspaceId, window),
  );
  return rows.map((row) => ({
    date: row.day,
    runs: row.runs,
    reportedUsd: roundTo(row.reported_usd, 6),
    estimatedUsd: roundTo(row.estimated_usd, 6),
  }));
}

export async function jevSpend(
  db: Queryable,
  workspaceId: string,
  window: AnalyticsWindow,
): Promise<{ calls: number; costUsd: number }> {
  const { rows } = await db.query<{ calls: number; cost_usd: number }>(
    `SELECT count(*) FILTER (WHERE a.jev_status NOT IN ('not_connected', 'not_asked'))::int AS calls,
       COALESCE(sum(a.jev_cost_usd), 0)::float8 AS cost_usd
     FROM run_advice a JOIN runs r ON r.id = a.run_id
     JOIN conversations c ON c.id = r.conversation_id
     WHERE c.workspace_id = $1 AND ${WINDOW_FILTER}`,
    windowParams(workspaceId, window),
  );
  const row = rows[0];
  return { calls: row?.calls ?? 0, costUsd: roundTo(row?.cost_usd ?? 0, 6) };
}

interface SessionRow {
  provider: string;
  model: string | null;
  model_label: string | null;
  cached_read_tokens: number | null;
  resumed: boolean;
}

export async function sessionRuns(
  db: Queryable,
  workspaceId: string,
  window: AnalyticsWindow,
): Promise<SessionRun[]> {
  const { rows } = await db.query<SessionRow>(
    `SELECT r.provider, COALESCE(r.used_model, r.model) AS model,
       r.route->>'modelLabel' AS model_label, r.cached_read_tokens,
       bool_or(e.payload->>'stepName' = 'Continued session') AS resumed
     FROM runs r JOIN conversations c ON c.id = r.conversation_id
     JOIN run_events e ON e.run_id = r.id AND e.type = 'STEP_STARTED'
       AND (e.payload->>'stepName' = 'Continued session'
         OR e.payload->>'stepName' LIKE 'Fresh session%')
     WHERE c.workspace_id = $1 AND ${WINDOW_FILTER}
     GROUP BY r.id`,
    windowParams(workspaceId, window),
  );
  return rows.map((row) => ({
    provider: row.provider,
    model: row.model,
    modelLabel: row.model_label,
    cachedReadTokens: row.cached_read_tokens,
    resumed: row.resumed,
  }));
}
