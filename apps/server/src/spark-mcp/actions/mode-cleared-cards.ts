import {
  SPARK_ACTION_KIND,
  type Approval,
  type RunEvent,
  type SparkActionName,
  type SparkResult,
} from '@spark-outpost/contracts';
import { getApproval } from '../../persistence/approvals.ts';
import type { Queryable } from '../../persistence/db.ts';
import { settleSparkActionByMode } from '../../persistence/spark-results.ts';
import { runEvents } from '../../workflow/run-events.ts';
import { actionFacts, actionPath } from './action-policy.ts';

const GATED_READS: readonly SparkActionName[] = [
  'atlassian_read',
  'servicenow_read',
  'github_read',
  'calendar_read',
];

export const CLEARED_BY_MODE: SparkResult = {
  state: 'done',
  message: 'Not needed any more: the agent’s mode now reads without asking.',
  url: null,
};

export async function clearReadCardsTheModeRuns(
  db: Queryable,
  runId: string,
  append: (event: RunEvent) => Promise<unknown>,
): Promise<Approval[]> {
  const { rows } = await db.query<{ id: string; action: SparkActionName }>(
    `SELECT id, payload->'sparkAction'->>'action' AS action FROM approvals
     WHERE run_id = $1 AND kind = $2 AND status = 'pending'
       AND payload->'sparkAction'->>'action' = ANY($3::text[])
     ORDER BY created_at`,
    [runId, SPARK_ACTION_KIND, GATED_READS],
  );
  const cleared: Approval[] = [];
  for (const row of rows) {
    if (actionPath(await actionFacts(db, runId, row.action)) !== 'perform') continue;
    const settled = await settleSparkActionByMode(db, row.id, CLEARED_BY_MODE);
    if (!settled) continue;
    cleared.push(settled);
    await append(runEvents.approvalDecided(settled)).catch(() => undefined);
  }
  return cleared;
}

export async function clearedByMode(db: Queryable, approvalId: string): Promise<boolean> {
  return (await getApproval(db, approvalId))?.decidedBy === 'level';
}
