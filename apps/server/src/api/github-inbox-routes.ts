import { Router } from 'express';
import {
  githubInboxSeenRequestSchema,
  githubInboxWindowRequestSchema,
  githubPullIdSchema,
} from '@spark-outpost/contracts';
import { loadGithubInbox } from '../github-inbox/load.ts';
import { markInboxSeen, saveInboxWindowDays } from '../persistence/github-inbox.ts';
import type { GitHubDeps } from '../ship/github/access.ts';
import { BadRequestError, parseBody } from './validation.ts';

const HEAD_SHA = /^[0-9a-f]{40,64}$/;

export function githubInboxRoutes(deps: GitHubDeps): Router {
  const router = Router();

  router.get('/github/inbox', async (req, res) => {
    res.json(await loadGithubInbox(deps, { refresh: req.query.refresh === '1' }));
  });

  router.post('/github/inbox/seen', async (req, res) => {
    const seen = parseBody(githubInboxSeenRequestSchema, req);
    if (!githubPullIdSchema.safeParse(seen.id).success || !HEAD_SHA.test(seen.headSha)) {
      throw new BadRequestError('Invalid request: id, headSha.');
    }
    await markInboxSeen(deps.db, deps.workspaceId, seen.id, seen.headSha);
    res.json(await loadGithubInbox(deps));
  });

  router.put('/github/inbox/window', async (req, res) => {
    const { windowDays } = parseBody(githubInboxWindowRequestSchema, req);
    await saveInboxWindowDays(deps.db, deps.workspaceId, windowDays);
    res.json(await loadGithubInbox(deps));
  });

  return router;
}
