import { Router } from 'express';
import { digestTriggerSchema, spendRangeSchema } from '@spark-outpost/contracts';
import { digestState, requestDigest } from '../digest/service.ts';
import type { Db } from '../persistence/db.ts';
import { providerIssues } from '../persistence/provider-health.ts';
import { spendSummary } from '../persistence/spend.ts';
import { timeZoneParam } from './time-zone-param.ts';
import { BadRequestError, parseBody } from './validation.ts';

export interface HomeRouteDeps {
  db: Db;
  workspaceId: string;
}

export function homeRoutes({ db, workspaceId }: HomeRouteDeps): Router {
  const router = Router();

  router.get('/usage/spend', async (req, res) => {
    const range = spendRangeSchema.safeParse(req.query.range ?? 'today');
    if (!range.success) throw new BadRequestError('The range must be today or week.');
    res.json(await spendSummary(db, workspaceId, range.data, timeZoneParam(req.query.tz)));
  });

  router.get('/providers/health', async (_req, res) => {
    res.json({ issues: await providerIssues(db, workspaceId) });
  });

  router.get('/home/digest', async (_req, res) => {
    res.json(await digestState(db, workspaceId));
  });

  router.post('/home/digest', async (req, res) => {
    const { trigger } = parseBody(digestTriggerSchema, req);
    res.json(await requestDigest(db, workspaceId, trigger, timeZoneParam(req.query.tz)));
  });

  return router;
}
