import { TEST_RUN_CHAT_KIND, workflowProblems, type Workflow } from '@spark-outpost/contracts';
import { insertWorkflowRun } from '../../crew-flows/run-records.ts';
import { stepSparks, workspaceSparkIds } from '../../crew-flows/step-sparks.ts';
import { oneSparkWorkflow } from '../../crew-flows/test-run.ts';
import type { WorkflowStore } from '../../crew-flows/workflow-store.ts';
import {
  createConversation,
  sendInTransaction,
  type RunTarget,
} from '../../persistence/conversations.ts';
import { withTransaction, type Db } from '../../persistence/db.ts';
import { newId } from '../../persistence/ids.ts';
import type { GitHubDeps } from '../../ship/github/access.ts';
import {
  gatherMaterial,
  renderMaterial,
  ReviewSetupError,
  type MaterialFacts,
} from './material.ts';
import { retryFailedBefore } from './decide.ts';
import {
  dropUnstartedReview,
  failReview,
  headCoveredByAnother,
  settleReview,
  type ClaimedReview,
} from './queue.ts';
import { earlierReview } from './views.ts';

export interface ReviewStartDeps {
  db: Db;
  workspaceId: string;
  github: GitHubDeps;
  store: WorkflowStore;
  runTarget(conversationId: string): Promise<RunTarget>;
  now(): Date;
}

export const REVIEWER_GONE = 'The reviewer no longer exists. Pick another one.';
export const PULL_CLOSED = 'The pull request is closed, so it was not reviewed.';

class ReviewStoppedError extends Error {}
class ReviewNotNeededError extends Error {}

async function autoReviewStillNeeded(
  deps: ReviewStartDeps,
  claim: ClaimedReview,
  detail: MaterialFacts['detail'],
): Promise<boolean> {
  if (claim.source !== 'auto') return true;
  if (detail.draft) return false;
  const before = retryFailedBefore(deps.now());
  return !(await headCoveredByAnother(deps.db, claim, detail.head.sha, before));
}

async function reviewerWorkflow(deps: ReviewStartDeps, claim: ClaimedReview): Promise<Workflow> {
  if (claim.reviewer.kind === 'spark') {
    const spark = (await stepSparks(deps.db, deps.workspaceId, [claim.reviewer.id])).get(
      claim.reviewer.id,
    );
    if (!spark) throw new ReviewSetupError(REVIEWER_GONE);
    return oneSparkWorkflow(spark);
  }
  const file = await deps.store.read(claim.reviewer.id);
  if (!file) throw new ReviewSetupError(REVIEWER_GONE);
  const sparkIds = await workspaceSparkIds(deps.db, deps.workspaceId);
  const [problem] = workflowProblems(file.workflow.steps, sparkIds);
  if (problem) throw new ReviewSetupError(`The workflow can’t run: ${problem.text}`);
  return file.workflow;
}

async function alreadyStarted(deps: ReviewStartDeps, claim: ClaimedReview): Promise<boolean> {
  const { rowCount } = await deps.db.query(
    `SELECT 1 FROM workflow_runs w JOIN runs r ON r.id = w.run_id
     WHERE r.user_message_id = $1 AND w.workspace_id = $2`,
    [claim.id, deps.workspaceId],
  );
  return rowCount === 1;
}

async function launch(deps: ReviewStartDeps, claim: ClaimedReview): Promise<void> {
  if (await alreadyStarted(deps, claim)) return;
  const workflow = await reviewerWorkflow(deps, claim);
  const earlier = await earlierReview(
    deps.db,
    deps.workspaceId,
    claim.pull,
    claim.reviewer,
    claim.id,
  );
  const facts = await gatherMaterial(deps.github, claim.pull, earlier);
  if (facts.detail.state !== 'open') throw new ReviewSetupError(PULL_CLOSED);
  if (!(await autoReviewStillNeeded(deps, claim, facts.detail))) throw new ReviewNotNeededError();
  const material = renderMaterial(facts);
  const conversationId = newId();
  const target = await deps.runTarget(conversationId);
  const workflowRunId = newId();
  await withTransaction(deps.db, async (client) => {
    await createConversation(client, deps.workspaceId, conversationId, {
      title: `Review: ${claim.pull}`.slice(0, 100),
    });
    await client.query('UPDATE conversations SET kind = $2 WHERE id = $1', [
      conversationId,
      TEST_RUN_CHAT_KIND,
    ]);
    const sent = await sendInTransaction(
      client,
      conversationId,
      { id: claim.id, content: `@${workflow.id} Review ${claim.pull}`, source: 'workflow' },
      target,
    );
    await insertWorkflowRun(client, {
      id: workflowRunId,
      workspaceId: deps.workspaceId,
      workflow,
      kind: 'review',
      source: claim.source === 'auto' ? 'github_auto' : 'github_page',
      pull: claim.pull,
      conversationId,
      runId: sent.run.id,
      message: `Review ${claim.pull}`,
      continues: false,
      oneSpark: claim.reviewer.kind === 'spark',
    });
    const attached = await client.query(
      `UPDATE github_reviews SET workflow_run_id = $2, conversation_id = $3, head_sha = $4,
         material = $5, started_at = now()
       WHERE id = $1 AND state = 'running' AND stop_requested_at IS NULL`,
      [claim.id, workflowRunId, conversationId, facts.detail.head.sha, material],
    );
    if (attached.rowCount !== 1) throw new ReviewStoppedError();
  });
}

export async function startReview(deps: ReviewStartDeps, claim: ClaimedReview): Promise<void> {
  try {
    await launch(deps, claim);
  } catch (error) {
    if (error instanceof ReviewStoppedError) {
      const stopped = { state: 'stopped', body: null, error: null } as const;
      await settleReview(deps.db, claim.id, stopped, { costUsd: null, tokens: null });
      return;
    }
    if (error instanceof ReviewNotNeededError) {
      await dropUnstartedReview(deps.db, claim.id);
      return;
    }
    const known = error instanceof ReviewSetupError;
    if (!known) console.error(`Could not start the review of ${claim.pull}`, error);
    const message = known
      ? error.message
      : `Spark couldn’t start the review: ${(error as Error).message}`;
    await failReview(deps.db, claim.id, message);
  }
}
