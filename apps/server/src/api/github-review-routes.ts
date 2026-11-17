import { Router } from 'express';
import { z } from 'zod';
import {
  githubPullIdSchema,
  githubReviewRequestSchema,
  githubReviewSettingsUpdateSchema,
} from '@spark-outpost/contracts';
import type { WorkflowStore } from '../crew-flows/workflow-store.ts';
import {
  ReviewNotFoundError,
  requestReviewNow,
  reviewRunnerDeps,
  stopReview,
} from '../github-inbox/review/runner.ts';
import { saveReviewSettings, settingsView } from '../github-inbox/review/settings.ts';
import { settleRunningReviews } from '../github-inbox/review/settle.ts';
import { listReviews } from '../github-inbox/review/views.ts';
import { gitHubDepsOf, type GitHubRouteDeps } from './ship-routes.ts';
import { BadRequestError, parseBody, parseQuery } from './validation.ts';

export interface GithubReviewRouteDeps extends GitHubRouteDeps {
  fixedRunProvider?: string | undefined;
  workflows?: WorkflowStore | undefined;
  nudgeReviews?: (() => void) | undefined;
}

const listQuerySchema = z.object({ pull: githubPullIdSchema });
const reviewIdSchema = z.uuid();

export function githubReviewErrorStatus(
  error: unknown,
): { status: number; message: string } | null {
  return error instanceof ReviewNotFoundError ? { status: 404, message: error.message } : null;
}

export function githubReviewRoutes(routeDeps: GithubReviewRouteDeps): Router {
  const { db, workspaceId } = routeDeps;
  const deps = reviewRunnerDeps(gitHubDepsOf(routeDeps), {
    store: routeDeps.workflows,
    fixedRunProvider: routeDeps.fixedRunProvider,
  });
  const { store } = deps;
  const router = Router();

  router.get('/github/review-settings', async (_req, res) => {
    res.json(await settingsView(db, workspaceId, store));
  });

  router.put('/github/review-settings', async (req, res) => {
    await saveReviewSettings(
      db,
      workspaceId,
      store,
      parseBody(githubReviewSettingsUpdateSchema, req),
    );
    res.json(await settingsView(db, workspaceId, store));
  });

  router.get('/github/reviews', async (req, res) => {
    const { pull } = parseQuery(listQuerySchema, req);
    await settleRunningReviews(db, workspaceId, deps.now(), Number.POSITIVE_INFINITY);
    res.json({ reviews: await listReviews(db, workspaceId, pull) });
  });

  router.post('/github/reviews', async (req, res) => {
    const { pull } = parseBody(githubReviewRequestSchema, req);
    const review = await requestReviewNow(deps, pull);
    routeDeps.nudgeReviews?.();
    res.status(201).json(review);
  });

  router.post('/github/reviews/:id/stop', async (req, res) => {
    const id = reviewIdSchema.safeParse(req.params.id);
    if (!id.success) throw new BadRequestError('Invalid review id.');
    res.json(await stopReview(deps, id.data));
  });

  return router;
}
