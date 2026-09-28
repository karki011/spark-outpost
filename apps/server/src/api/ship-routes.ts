import { Router } from 'express';
import { saveGitHubTokenRequestSchema, shipRequestSchema } from '@spark-outpost/contracts';
import type { Db } from '../persistence/db.ts';
import { DEFAULT_BRANCH_PREFIX } from '../projects/worktrees.ts';
import type { RunCommand } from '../setup/command.ts';
import type { SecretStore } from '../setup/secrets.ts';
import { locateCli, type ApiEndpoints } from '../setup/verify.ts';
import { ShipGitError } from '../ship/git.ts';
import { gitHubStatus, removeToken, saveToken, type GitHubDeps } from '../ship/github/access.ts';
import { GitHubApiError } from '../ship/github/connection.ts';
import { ShipBlockedError, type ShipDeps } from '../ship/prepare.ts';
import { shipPreview, shipTask } from '../ship/service.ts';
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

function shipDeps(deps: ShipRouteDeps): ShipDeps {
  const github: GitHubDeps = {
    db: deps.db,
    workspaceId: deps.workspaceId,
    secrets: deps.secrets,
    runCommand: deps.runCommand,
    fetch: deps.endpoints.fetch,
    apiUrl: deps.githubApiUrl,
    locateGh: deps.locateGh ?? (() => locateCli('gh', deps.runCommand, deps.loginShell)),
  };
  return { ...github, branchPrefix: deps.branchPrefix ?? DEFAULT_BRANCH_PREFIX };
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
    res.json(await saveToken(deps, request.token, request.host));
  });

  router.delete('/github/token', async (_req, res) => {
    res.json(await removeToken(deps));
  });

  return router;
}
