import { Router } from 'express';
import { saveGitHubTokenRequestSchema, shipRequestSchema } from '@spark-outpost/contracts';
import type { Db } from '../persistence/db.ts';
import { DEFAULT_BRANCH_PREFIX } from '../projects/worktrees.ts';
import type { RunCommand } from '../setup/command.ts';
import type { SecretStore } from '../setup/secrets.ts';
import { locateCli, type ApiEndpoints } from '../setup/verify.ts';
import { ShipGitError } from '../ship/git.ts';
import { gitHubStatus, removeToken, saveToken, type GitHubDeps } from '../ship/github/access.ts';
import type { GitHubAppConfig } from '../ship/github/app-config.ts';
import type { Sleep } from '../ship/github/app-sign-in.ts';
import { GitHubApiError } from '../ship/github/connection.ts';
import { ShipBlockedError, type ShipDeps } from '../ship/prepare.ts';
import { conversationPrRoute, forgetPrRoutes, testGitHub } from '../ship/route-check.ts';
import { shipPreview, shipTask } from '../ship/service.ts';
import { loginShellEnv, loginShellPath } from '../setup/login-path.ts';
import { gitHubAppRoutes } from './github-app-routes.ts';
import { paramId, parseBody } from './validation.ts';

export interface ShipRouteDeps {
  db: Db;
  workspaceId: string;
  secrets: SecretStore;
  runCommand: RunCommand;
  loginShell: string | null;
  endpoints: ApiEndpoints;
  branchPrefix?: string;
  githubApiUrl?: string | undefined;
  locateGh?: () => Promise<string | null>;
  githubApp?: GitHubAppConfig | null | undefined;
  githubSignInSleep?: Sleep;
}

export function shipErrorStatus(error: unknown): { status: number; message: string } | null {
  if (error instanceof ShipBlockedError || error instanceof ShipGitError) {
    return { status: 409, message: error.message };
  }
  if (error instanceof GitHubApiError) {
    return { status: error.status === 401 ? 400 : 502, message: error.message };
  }
  return null;
}

export type GitHubRouteDeps = Omit<ShipRouteDeps, 'branchPrefix'>;

export function gitHubDepsOf(deps: GitHubRouteDeps): GitHubDeps {
  return {
    db: deps.db,
    workspaceId: deps.workspaceId,
    secrets: deps.secrets,
    runCommand: deps.runCommand,
    fetch: deps.endpoints.fetch,
    apiUrl: deps.githubApiUrl,
    locateGh: deps.locateGh ?? (() => locateCli('gh', deps.runCommand, deps.loginShell)),
    loginPath: loginShellPath(deps.runCommand, deps.loginShell),
    loginEnv: loginShellEnv(deps.runCommand, deps.loginShell),
    app: deps.githubApp,
  };
}

function shipDeps(deps: ShipRouteDeps): ShipDeps {
  return { ...gitHubDepsOf(deps), branchPrefix: deps.branchPrefix ?? DEFAULT_BRANCH_PREFIX };
}

export function shipRoutes(routeDeps: ShipRouteDeps): Router {
  const deps = shipDeps(routeDeps);
  const router = Router();

  router.get('/tasks/:id/ship', async (req, res) => {
    res.json(await shipPreview(deps, paramId(req)));
  });

  router.post('/tasks/:id/ship', async (req, res) => {
    res.json(await shipTask(deps, paramId(req), parseBody(shipRequestSchema, req)));
  });

  router.get('/github/connection', async (_req, res) => {
    res.json(await gitHubStatus(deps));
  });

  router.put('/github/token', async (req, res) => {
    const request = parseBody(saveGitHubTokenRequestSchema, req);
    forgetPrRoutes();
    res.json(await saveToken(deps, request.token, request.host));
  });

  router.delete('/github/token', async (_req, res) => {
    forgetPrRoutes();
    res.json(await removeToken(deps));
  });

  router.use(gitHubAppRoutes(deps, routeDeps.githubSignInSleep));

  router.post('/github/test', async (_req, res) => {
    res.json(await testGitHub(deps));
  });

  router.get('/conversations/:id/pr-route', async (req, res) => {
    res.json({ info: await conversationPrRoute(deps, paramId(req)) });
  });

  return router;
}
