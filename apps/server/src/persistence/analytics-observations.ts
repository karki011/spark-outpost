import type { AnalyticsWindow, ObservationSummary } from '@spark-outpost/contracts';
import type { Queryable } from './db.ts';
import { WINDOW_FILTER, windowParams } from './analytics-facts.ts';

interface ObservationRowData {
  would: string | null;
  actual: string;
  count: number;
}

async function rows(
  db: Queryable,
  workspaceId: string,
  window: AnalyticsWindow,
  purpose: 'policy' | 'verify',
  actual: string,
): Promise<ObservationRowData[]> {
  const { rows: found } = await db.query<ObservationRowData>(
    `SELECT a.body->'answer'->>'would' AS would, ${actual} AS actual, count(*)::int AS count
     FROM run_advice a JOIN runs r ON r.id = a.run_id
     JOIN conversations c ON c.id = r.conversation_id
     LEFT JOIN approvals ap ON ap.id = (a.body->'answer'->'actual'->>'approvalId')::uuid
     LEFT JOIN task_outcomes o ON o.run_id = r.id
     WHERE c.workspace_id = $1 AND ${WINDOW_FILTER} AND a.purpose = '${purpose}'
     GROUP BY 1, 2 ORDER BY 3 DESC`,
    windowParams(workspaceId, window),
  );
  return found;
}

function summary(found: readonly ObservationRowData[]): ObservationSummary {
  const checked = found.filter((row) => row.would !== null);
  return {
    checks: checked.reduce((sum, row) => sum + row.count, 0),
    skipped: found.filter((row) => row.would === null).reduce((sum, row) => sum + row.count, 0),
    rows: checked.map((row) => ({ would: row.would!, actual: row.actual, count: row.count })),
  };
}

const APPROVAL_OUTCOME = `CASE
  WHEN ap.id IS NULL THEN 'unknown'
  WHEN ap.status = 'allowed' AND ap.decided_by = 'user' THEN 'you allowed'
  WHEN ap.status = 'allowed' THEN 'allowed by the rules'
  WHEN ap.status = 'denied' AND ap.decided_by = 'user' THEN 'you denied'
  WHEN ap.status = 'denied' THEN 'refused by the rules'
  ELSE ap.status END`;

export async function observationSummaries(
  db: Queryable,
  workspaceId: string,
  window: AnalyticsWindow,
): Promise<{ policy: ObservationSummary; verify: ObservationSummary }> {
  const [policy, verify] = await Promise.all([
    rows(db, workspaceId, window, 'policy', APPROVAL_OUTCOME),
    rows(db, workspaceId, window, 'verify', `COALESCE(o.verdict, 'pending')`),
  ]);
  return { policy: summary(policy), verify: summary(verify) };
}
