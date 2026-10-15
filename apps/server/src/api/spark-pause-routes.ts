import { Router } from 'express';
import { sparkPauseRequestSchema } from '@spark-outpost/contracts';
import type { Db } from '../persistence/db.ts';
import { pollWaitingRounds } from '../persistence/pr-watches.ts';
import { setSparkPaused, sparkPause } from '../persistence/spark-pause.ts';
import { drainWaiting } from '../workflow/queue-drain.ts';
import { resolveRunTarget } from './run-target.ts';
import { parseBody } from './validation.ts';

export interface SparkPauseRouteDeps {
  db: Db;
  workspaceId: string;
  fixedRunProvider?: string;
}

async function announce(db: Db): Promise<void> {
  await db.query(`SELECT pg_notify('changes', $1)`, [
    JSON.stringify({ kind: 'spark_pause', conversationId: null, runId: null }),
  ]);
}

export function sparkPauseRoutes({
  db,
  workspaceId,
  fixedRunProvider,
}: SparkPauseRouteDeps): Router {
  const router = Router();

  const releaseHeld = async () => {
    await pollWaitingRounds(db, workspaceId);
    await drainWaiting(db, (conversationId) =>
      resolveRunTarget({ db, workspaceId, fixedRunProvider }, conversationId),
    );
  };

  router.get('/spark-pause', async (_req, res) => {
    res.json(await sparkPause(db, workspaceId));
  });

  router.put('/spark-pause', async (req, res) => {
    const { paused } = parseBody(sparkPauseRequestSchema, req);
    const state = await setSparkPaused(db, workspaceId, paused);
    await announce(db);
    if (!paused) {
      await releaseHeld().catch((error: unknown) =>
        console.error('Could not start the work held while Spark was paused', error),
      );
    }
    res.json(state);
  });

  return router;
}
