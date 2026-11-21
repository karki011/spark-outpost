import { isTerminalRunStatus, type RunStatus, type WorkflowRun } from '@spark-outpost/contracts';
import { getWorkflowRun } from '../../crew-flows/run-records.ts';
import type { Queryable } from '../../persistence/db.ts';
import { reviewEnd, type ReviewEnd } from './decide.ts';
import { settleReview, type ReviewUsage } from './queue.ts';
import { reviewSettings } from './settings.ts';
import { reviewJobFor } from './views.ts';
import type { ReviewOptions } from '../../crew-flows/run-workflow.ts';

export async function reviewOptions(
  db: Queryable,
  workspaceId: string,
  workflowRunId: string,
): Promise<ReviewOptions | null> {
  const job = await reviewJobFor(db, workflowRunId);
  if (!job) return null;
  const settings = await reviewSettings(db, workspaceId);
  return {
    material: job.material,
    permission: { mayPost: settings.mayPost, mayApprove: settings.mayPost && settings.mayApprove },
  };
}

async function usageOf(db: Queryable, conversationId: string | null): Promise<ReviewUsage> {
  if (!conversationId) return { costUsd: null, tokens: null };
  const { rows } = await db.query<{ tokens: string | null; cost: string | null }>(
    `SELECT sum(COALESCE(total_tokens, input_tokens + output_tokens)) AS tokens,
            sum(cost_usd) AS cost
     FROM runs WHERE conversation_id = $1`,
    [conversationId],
  );
  const row = rows[0];
  return {
    costUsd: row?.cost == null ? null : Number(row.cost),
    tokens: row?.tokens == null ? null : Number(row.tokens),
  };
}

function endOf(run: WorkflowRun, runStatus: RunStatus | null, stopping: boolean): ReviewEnd | null {
  const definition = run.steps.map((step) => ({ id: step.stepId, dependsOn: step.dependsOn }));
  if (run.status !== 'running') return reviewEnd(run.status, definition, run.steps, stopping);
  if (runStatus === null || isTerminalRunStatus(runStatus)) {
    return reviewEnd('outcome_unknown', definition, run.steps, stopping);
  }
  return null;
}

interface RunningRow {
  id: string;
  workspace_id: string;
  workflow_run_id: string | null;
  conversation_id: string | null;
  elsewhere: boolean;
  stopping: boolean;
  claimed_at: Date | null;
  run_status: RunStatus | null;
}

const RUNNING_SELECT = `SELECT g.id, g.workspace_id, g.workflow_run_id, g.conversation_id,
    g.source = 'elsewhere' AS elsewhere,
    g.stop_requested_at IS NOT NULL AS stopping, g.claimed_at, r.status AS run_status
  FROM github_reviews g
  LEFT JOIN workflow_runs w ON w.id = g.workflow_run_id
  LEFT JOIN runs r ON r.id = w.run_id`;

async function settleRow(db: Queryable, row: RunningRow, now: Date, strandedMs: number) {
  if (!row.workflow_run_id) {
    const stale = row.claimed_at && now.getTime() - row.claimed_at.getTime() > strandedMs;
    if (row.stopping && stale) {
      await settleReview(
        db,
        row.id,
        { state: 'stopped', body: null, error: null },
        {
          costUsd: null,
          tokens: null,
        },
      );
    }
    return;
  }
  const run = await getWorkflowRun(db, row.workspace_id, row.workflow_run_id);
  if (!run) return;
  const end = endOf(run, row.run_status, row.stopping);
  if (!end) return;
  const usage = row.elsewhere
    ? { costUsd: run.spend.costUsd, tokens: run.spend.tokens }
    : await usageOf(db, row.conversation_id);
  await settleReview(db, row.id, end, usage);
}

export async function settleReviewOfWorkflowRun(
  db: Queryable,
  workflowRunId: string,
): Promise<void> {
  const { rows } = await db.query<RunningRow>(
    `${RUNNING_SELECT} WHERE g.workflow_run_id = $1 AND g.state = 'running'`,
    [workflowRunId],
  );
  for (const row of rows) await settleRow(db, row, new Date(), 0);
}

export async function settleRunningReviews(
  db: Queryable,
  workspaceId: string,
  now: Date,
  strandedMs: number,
): Promise<void> {
  const { rows } = await db.query<RunningRow>(
    `${RUNNING_SELECT} WHERE g.workspace_id = $1 AND g.state = 'running'`,
    [workspaceId],
  );
  for (const row of rows) await settleRow(db, row, now, strandedMs);
}
