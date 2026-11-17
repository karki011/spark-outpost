import type { GithubReview } from '@spark-outpost/contracts';
import { resolveRunTarget } from '../../api/run-target.ts';
import { BadRequestError } from '../../api/validation.ts';
import { workflowStore, type WorkflowStore } from '../../crew-flows/workflow-store.ts';
import { loadGithubInbox } from '../load.ts';
import { sparkPaused } from '../../persistence/spark-pause.ts';
import type { GitHubDeps } from '../../ship/github/access.ts';
import { stopRun } from '../../workflow/stop-run.ts';
import { autoReviewWanted, debouncedDue, pullKeyOf } from './decide.ts';
import { connectionForPull, readPullBasics, ReviewSetupError } from './material.ts';
import {
  claimDueReviews,
  enqueueReview,
  reclaimStrandedReviews,
  requestStop,
  reviewedHeads,
  type ReviewerSnapshot,
} from './queue.ts';
import { settleRunningReviews, settleReviewOfWorkflowRun } from './settle.ts';
import { reviewSettings, reviewerName, type StoredReviewSettings } from './settings.ts';
import { startReview, type ReviewStartDeps } from './start.ts';
import { getReview } from './views.ts';

export const STRANDED_REVIEW_MS = 60_000;
const CHECK_EVERY_MS = 30_000;

export interface ReviewRunnerDeps extends ReviewStartDeps {
  now(): Date;
}

export function reviewRunnerDeps(
  github: GitHubDeps,
  options: { store?: WorkflowStore | undefined; fixedRunProvider?: string | undefined } = {},
): ReviewRunnerDeps {
  const { db, workspaceId } = github;
  return {
    db,
    workspaceId,
    store: options.store ?? workflowStore(),
    github,
    runTarget: (conversationId) =>
      resolveRunTarget(
        { db, workspaceId, fixedRunProvider: options.fixedRunProvider },
        conversationId,
      ),
    now: () => new Date(),
  };
}

export const NO_REVIEWER = 'Pick a Spark or workflow to review with first.';

async function snapshotOf(
  deps: ReviewRunnerDeps,
  settings: StoredReviewSettings,
): Promise<ReviewerSnapshot | null> {
  if (!settings.reviewer) return null;
  const name = await reviewerName(deps.db, deps.workspaceId, deps.store, settings.reviewer);
  return name ? { ...settings.reviewer, name } : null;
}

export async function queueAutoReviews(deps: ReviewRunnerDeps): Promise<number> {
  const settings = await reviewSettings(deps.db, deps.workspaceId);
  if (!settings.autoReview) return 0;
  const reviewer = await snapshotOf(deps, settings);
  if (!reviewer) return 0;
  const inbox = await loadGithubInbox(deps.github);
  const heads = await reviewedHeads(
    deps.db,
    deps.workspaceId,
    inbox.items.map((item) => item.id),
  );
  const wanted = inbox.items.filter((item) =>
    autoReviewWanted(item, settings, heads.get(pullKeyOf(item.id)) ?? new Set()),
  );
  const dueAt = debouncedDue(deps.now());
  for (const item of wanted) {
    await enqueueReview(deps.db, {
      workspaceId: deps.workspaceId,
      pull: item.id,
      headSha: item.headSha,
      reviewer,
      source: 'auto',
      dueAt,
    });
  }
  return wanted.length;
}

export async function startDueReviews(deps: ReviewRunnerDeps): Promise<void> {
  const now = deps.now();
  const claims = [
    ...(await reclaimStrandedReviews(deps.db, deps.workspaceId, now, STRANDED_REVIEW_MS)),
    ...(await claimDueReviews(deps.db, deps.workspaceId, now)),
  ];
  for (const claim of claims) await startReview(deps, claim);
}

export async function checkReviews(deps: ReviewRunnerDeps): Promise<void> {
  await settleRunningReviews(deps.db, deps.workspaceId, deps.now(), STRANDED_REVIEW_MS);
  if (await sparkPaused(deps.db, deps.workspaceId)) return;
  await queueAutoReviews(deps).catch((error: unknown) => {
    console.error('Could not look for pull requests to review', error);
  });
  await startDueReviews(deps);
}

export async function requestReviewNow(
  deps: ReviewRunnerDeps,
  pull: string,
): Promise<GithubReview> {
  const reviewer = await snapshotOf(deps, await reviewSettings(deps.db, deps.workspaceId));
  if (!reviewer) throw new BadRequestError(NO_REVIEWER);
  const detail = await connectionForPull(deps.github, pull)
    .then(({ connection, linked }) => readPullBasics(connection, linked))
    .catch((error: unknown) => {
      if (error instanceof ReviewSetupError) throw new BadRequestError(error.message);
      throw error;
    });
  if (detail.state !== 'open') throw new BadRequestError('This pull request is closed.');
  const id = await enqueueReview(deps.db, {
    workspaceId: deps.workspaceId,
    pull,
    headSha: detail.head.sha,
    reviewer,
    source: 'manual',
    dueAt: deps.now(),
  });
  const review = await getReview(deps.db, deps.workspaceId, id);
  if (!review) throw new Error('The review was not recorded.');
  return review;
}

export class ReviewNotFoundError extends Error {
  constructor() {
    super('That review no longer exists.');
  }
}

export async function stopReview(deps: ReviewRunnerDeps, id: string): Promise<GithubReview> {
  const target = await requestStop(deps.db, deps.workspaceId, id);
  if (!target) throw new ReviewNotFoundError();
  if (target.runId) await stopRun(deps.db, target.runId);
  const { rows } = await deps.db.query<{ workflow_run_id: string | null }>(
    'SELECT workflow_run_id FROM github_reviews WHERE id = $1',
    [id],
  );
  const workflowRunId = rows[0]?.workflow_run_id;
  if (workflowRunId) await settleReviewOfWorkflowRun(deps.db, workflowRunId);
  const review = await getReview(deps.db, deps.workspaceId, id);
  if (!review) throw new ReviewNotFoundError();
  return review;
}

export interface ReviewRunner {
  stop(): void;
  nudge(): void;
}

export function startReviewRunner(deps: ReviewRunnerDeps, everyMs = CHECK_EVERY_MS): ReviewRunner {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await checkReviews(deps);
    } catch (error) {
      console.error('The pull request review check failed', error);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), everyMs);
  timer.unref();
  return { stop: () => clearInterval(timer), nudge: () => void tick() };
}
