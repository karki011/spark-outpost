import { Router } from 'express';
import type { GitHubAppSignIn } from '@spark-outpost/contracts';
import { disconnectApp, recheckAppRepos, type GitHubDeps } from '../ship/github/access.ts';
import { createAppSignIn, type Sleep } from '../ship/github/app-sign-in.ts';
import { forgetPrRoutes } from '../ship/route-check.ts';
import { BadRequestError } from './validation.ts';

const NOT_SET_UP = 'Signing in with GitHub is not set up in this build.';

const IDLE: GitHubAppSignIn = {
  status: 'idle',
  userCode: null,
  verificationUri: null,
  expiresAt: null,
  message: null,
};

export function gitHubAppRoutes(deps: GitHubDeps, sleep?: Sleep): Router {
  const router = Router();
  const app = deps.app;
  const signIn = app
    ? createAppSignIn({ ...deps, app, onConnected: forgetPrRoutes, ...(sleep ? { sleep } : {}) })
    : null;

  router.get('/github/app/sign-in', (_req, res) => {
    res.json(signIn?.state() ?? IDLE);
  });

  router.post('/github/app/sign-in', async (_req, res) => {
    if (!signIn) throw new BadRequestError(NOT_SET_UP);
    res.json(await signIn.start());
  });

  router.delete('/github/app/sign-in', async (_req, res) => {
    res.json(signIn ? await signIn.cancel() : IDLE);
  });

  router.post('/github/app/repos', async (_req, res) => {
    forgetPrRoutes();
    res.json(await recheckAppRepos(deps));
  });

  router.delete('/github/app', async (_req, res) => {
    await signIn?.cancel();
    forgetPrRoutes();
    res.json(await disconnectApp(deps));
  });

  return router;
}
