import { Router } from 'express';
import {
  digestTriggerSchema,
  recapRefineRequestSchema,
  spendRangeSchema,
} from '@spark-outpost/contracts';
import { digestState, requestDigest } from '../digest/service.ts';
import { todaySummary } from '../digest/today.ts';
import type { Db } from '../persistence/db.ts';
import { appConnection } from '../persistence/github-app.ts';
import { homeSeen, markHomeSeen } from '../persistence/home-seen.ts';
import { providerIssues } from '../persistence/provider-health.ts';
import { spendSummary } from '../persistence/spend.ts';
import { recapState, refineRecap, requestRecap } from '../recap/service.ts';
import type { SecretStore } from '../setup/secrets.ts';
import { timeZoneParam } from './time-zone-param.ts';
import { BadRequestError, paramId, parseBody } from './validation.ts';

export interface HomeRouteDeps {
  db: Db;
  workspaceId: string;
  secrets: Pick<SecretStore, 'waiting'>;
}

export function homeRoutes({ db, workspaceId, secrets }: HomeRouteDeps): Router {
  const router = Router();

  router.get('/usage/spend', async (req, res) => {
    const range = spendRangeSchema.safeParse(req.query.range ?? 'today');
    if (!range.success) throw new BadRequestError('The range must be today or week.');
    res.json(await spendSummary(db, workspaceId, range.data, timeZoneParam(req.query.tz)));
  });

  router.get('/providers/health', async (_req, res) => {
    res.json({
      issues: await providerIssues(db, workspaceId),
      keychainWaiting: secrets.waiting(),
      githubSignInNeeded: (await appConnection(db, workspaceId))?.state === 'needs_sign_in',
    });
  });

  router.get('/home/digest', async (_req, res) => {
    res.json(await digestState(db, workspaceId));
  });

  router.get('/home/seen', async (_req, res) => {
    res.json(await homeSeen(db, workspaceId));
  });

  router.post('/home/seen', async (_req, res) => {
    res.json(await markHomeSeen(db, workspaceId));
  });

  router.get('/home/today', async (req, res) => {
    res.json(await todaySummary(db, workspaceId, timeZoneParam(req.query.tz)));
  });

  router.post('/home/digest', async (req, res) => {
    const { trigger } = parseBody(digestTriggerSchema, req);
    res.json(await requestDigest(db, workspaceId, trigger, timeZoneParam(req.query.tz)));
  });

  router.get('/home/recap', async (_req, res) => {
    res.json(await recapState(db, workspaceId));
  });

  router.post('/home/recap', async (_req, res) => {
    res.json(await requestRecap(db, workspaceId));
  });

  router.post('/home/recap/:id/refine', async (req, res) => {
    const request = parseBody(recapRefineRequestSchema, req);
    res.json(await refineRecap(db, workspaceId, paramId(req), request));
  });

  return router;
}
