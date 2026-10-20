import { Router } from 'express';
import { adoptPullRequestSchema, type AdoptPullResult } from '@spark-outpost/contracts';
import { AdoptError, adoptPull, openPullsFor, type AdoptDeps } from '../projects/adopt-pull.ts';
import { DEFAULT_BRANCH_PREFIX } from '../projects/worktrees.ts';
import { workspaceOf } from './chat-workspace-routes.ts';
import { gitHubDepsOf, type GitHubRouteDeps } from './ship-routes.ts';
import { paramId, parseBody } from './validation.ts';

export type AdoptRouteDeps = GitHubRouteDeps & { branchPrefix?: string };

export function adoptErrorStatus(error: unknown): { status: number; message: string } | null {
  return error instanceof AdoptError ? { status: error.status, message: error.message } : null;
}

function adoptDepsOf(deps: AdoptRouteDeps): AdoptDeps {
  const github = gitHubDepsOf(deps);
  return {
    db: deps.db,
    workspaceId: deps.workspaceId,
    branchPrefix: deps.branchPrefix ?? DEFAULT_BRANCH_PREFIX,
    runner: async () => {
      const gh = await github.locateGh();
      return gh ? { gh, runCommand: deps.runCommand } : null;
    },
  };
}

function firstLine(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.split('\n')[0] ?? text;
}

export function adoptPullRoutes(routeDeps: AdoptRouteDeps): Router {
  const deps = adoptDepsOf(routeDeps);
  const router = Router();

  router.get('/projects/:id/pull-requests/open', async (req, res) => {
    res.json(await openPullsFor(deps, paramId(req)));
  });

  router.post('/conversations/:id/workspace/adopt', async (req, res) => {
    const conversationId = paramId(req);
    const request = parseBody(adoptPullRequestSchema, req);
    const note = await adoptPull(deps, conversationId, request).catch((error: unknown) => {
      if (error instanceof AdoptError) throw error;
      throw new AdoptError(409, `Couldn't set up the pull request's branch: ${firstLine(error)}`);
    });
    const body: AdoptPullResult = { workspace: await workspaceOf(deps.db, conversationId), note };
    res.json(body);
  });

  return router;
}
