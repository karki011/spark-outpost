import { Router } from 'express';
import { resetRequestSchema, type ResetReport } from '@spark-outpost/contracts';
import { resetSparkOutpost, type ResetDeps } from '../reset/reset.ts';
import { parseBody } from './validation.ts';

export function resetRoutes(deps: ResetDeps): Router {
  const router = Router();
  let running: Promise<ResetReport> | null = null;

  router.post('/reset', async (req, res) => {
    const { keepApiKeys } = parseBody(resetRequestSchema, req);
    if (running) {
      res.status(409).json({ error: 'Spark is already resetting.' });
      return;
    }
    running = resetSparkOutpost(deps, { keepApiKeys });
    try {
      res.json(await running);
    } finally {
      running = null;
    }
  });

  return router;
}
