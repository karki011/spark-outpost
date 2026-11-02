import { Router } from 'express';
import { userPluginUpdateSchema, type UserPluginsResponse } from '@spark-outpost/contracts';
import {
  applyPluginChoice,
  findPlugin,
  loadUserPlugins,
  PLUGIN_GONE,
  PLUGIN_REVIEW_RUNNING,
  PluginChoiceError,
  type LoadedPlugins,
} from '../agent-config/user-plugins/choice.ts';
import { claudeReviewModel, reviewPluginAgain } from '../agent-config/user-plugins/review.ts';
import { userPluginView } from '../agent-config/user-plugins/view.ts';
import type { Db } from '../persistence/db.ts';
import { AgentConfigConflictError } from './agent-config-routes.ts';
import { BadRequestError, parseBody } from './validation.ts';

export interface UserPluginRouteDeps {
  db: Db;
  workspaceId: string;
}

export const REVIEW_NEEDS_CLAUDE = 'Connect Claude to run the agent review.';

function viewOf({ plugins, choices }: LoadedPlugins): UserPluginsResponse {
  return {
    plugins: plugins.map((plugin) =>
      userPluginView(plugin, choices.get(plugin.plugin.installed.key)),
    ),
  };
}

function routeError(error: unknown): unknown {
  if (!(error instanceof PluginChoiceError)) return error;
  return error.problem === 'conflict'
    ? new AgentConfigConflictError(error.message)
    : new BadRequestError(error.message);
}

export function userPluginRoutes({ db, workspaceId }: UserPluginRouteDeps): Router {
  const router = Router();

  router.get('/user-plugins', async (_req, res) => {
    res.json(viewOf(await loadUserPlugins(db, workspaceId, true)));
  });

  router.put('/user-plugins/:key', async (req, res) => {
    const body = parseBody(userPluginUpdateSchema, req);
    const { plugins } = await loadUserPlugins(db, workspaceId, true);
    try {
      await applyPluginChoice(db, workspaceId, findPlugin(plugins, req.params.key), body);
    } catch (error) {
      throw routeError(error);
    }
    res.json(viewOf(await loadUserPlugins(db, workspaceId, false)));
  });

  router.post('/user-plugins/:key/review', async (req, res) => {
    const { plugins } = await loadUserPlugins(db, workspaceId, false);
    const found = findPlugin(plugins, req.params.key);
    if (!found) throw new BadRequestError(PLUGIN_GONE);
    if (found.plugin.unloadableReason) throw new BadRequestError(found.plugin.unloadableReason);
    const model = await claudeReviewModel(db, workspaceId);
    if (!model) throw new AgentConfigConflictError(REVIEW_NEEDS_CLAUDE);
    if (!(await reviewPluginAgain(db, workspaceId, found.plugin, model))) {
      throw new AgentConfigConflictError(PLUGIN_REVIEW_RUNNING);
    }
    res.json(viewOf(await loadUserPlugins(db, workspaceId, false)));
  });

  return router;
}
