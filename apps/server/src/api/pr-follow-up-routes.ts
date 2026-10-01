import { Router } from 'express';
import type { Db } from '../persistence/db.ts';
import { conversationWatches } from '../pr-follow-up/view.ts';
import { paramId } from './validation.ts';

export interface PrFollowUpRouteDeps {
  db: Db;
  workspaceId: string;
}

export function prFollowUpRoutes({ db, workspaceId }: PrFollowUpRouteDeps): Router {
  const router = Router();

  router.get('/conversations/:id/pull-requests', async (req, res) => {
    res.json({ watches: await conversationWatches(db, workspaceId, paramId(req)) });
  });

  return router;
}
