import { Router } from 'express';
import { conversationWatches } from '../pr-follow-up/view.ts';
import { chatPullRefresher } from '../pr-tracking/refresh.ts';
import { gitHubDepsOf, type GitHubRouteDeps } from './ship-routes.ts';
import { paramId } from './validation.ts';

export function prFollowUpRoutes(deps: GitHubRouteDeps): Router {
  const { db, workspaceId } = deps;
  const router = Router();
  const refresher = chatPullRefresher(gitHubDepsOf(deps));

  router.get('/conversations/:id/pull-requests', async (req, res) => {
    res.json({ watches: await conversationWatches(db, workspaceId, paramId(req)) });
  });

  router.post('/conversations/:id/pull-requests/refresh', async (req, res) => {
    const conversationId = paramId(req);
    const { rowCount } = await db.query(
      'SELECT 1 FROM conversations WHERE id = $1 AND workspace_id = $2',
      [conversationId, workspaceId],
    );
    if (rowCount) {
      await refresher.refresh(conversationId).catch((error: unknown) => {
        console.error('Could not refresh the pull requests of a chat', error);
      });
    }
    res.json({ watches: await conversationWatches(db, workspaceId, conversationId) });
  });

  return router;
}
