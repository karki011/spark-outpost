import { Router } from 'express';
import { setupTargetSchema, type SetupDrafts } from '@spark-outpost/contracts';
import type { Db } from '../persistence/db.ts';
import { deleteSetupDraft, listSetupDrafts } from '../persistence/setup-drafts.ts';

export interface SetupDraftRouteDeps {
  db: Db;
  workspaceId: string;
}

export function setupDraftRoutes({ db, workspaceId }: SetupDraftRouteDeps): Router {
  const router = Router();

  router.get('/setup-drafts', async (_req, res) => {
    const body: SetupDrafts = { drafts: await listSetupDrafts(db, workspaceId) };
    res.json(body);
  });

  router.delete('/setup-drafts/:target', async (req, res) => {
    const target = setupTargetSchema.safeParse(req.params.target);
    if (target.success) await deleteSetupDraft(db, workspaceId, target.data);
    const body: SetupDrafts = { drafts: await listSetupDrafts(db, workspaceId) };
    res.json(body);
  });

  return router;
}
