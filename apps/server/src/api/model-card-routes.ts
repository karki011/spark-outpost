import { Router } from 'express';
import { loadModelCards } from '../model-cards/load.ts';
import type { Db } from '../persistence/db.ts';

export interface ModelCardRouteDeps {
  db: Db;
  workspaceId: string;
}

export function modelCardRoutes({ db, workspaceId }: ModelCardRouteDeps): Router {
  const router = Router();

  router.get('/model-cards', async (_req, res) => {
    res.json(await loadModelCards(db, workspaceId, new Date()));
  });

  return router;
}
