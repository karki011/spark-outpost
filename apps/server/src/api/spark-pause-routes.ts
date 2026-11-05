import { Router } from 'express';
import { sparkPauseRequestSchema } from '@spark-outpost/contracts';
import type { Db } from '../persistence/db.ts';
import { sparkPause } from '../persistence/spark-pause.ts';
import { changeSparkPause } from '../workflow/spark-pause-change.ts';
import { resolveRunTarget } from './run-target.ts';
import { parseBody } from './validation.ts';

export interface SparkPauseRouteDeps {
  db: Db;
  workspaceId: string;
  fixedRunProvider?: string;
}

export function sparkPauseRoutes({
  db,
  workspaceId,
  fixedRunProvider,
}: SparkPauseRouteDeps): Router {
  const router = Router();

  router.get('/spark-pause', async (_req, res) => {
    res.json(await sparkPause(db, workspaceId));
  });

  router.put('/spark-pause', async (req, res) => {
    const { paused } = parseBody(sparkPauseRequestSchema, req);
    res.json(
      await changeSparkPause(db, workspaceId, paused, (conversationId) =>
        resolveRunTarget({ db, workspaceId, fixedRunProvider }, conversationId),
      ),
    );
  });

  return router;
}
