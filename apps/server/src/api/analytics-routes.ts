import { Router, type Request } from 'express';
import {
  analyticsQuerySchema,
  rollupQuerySchema,
  type AnalyticsWindow,
} from '@spark-outpost/contracts';
import { harnessReport, overviewReport, rollupReport, spendReport } from '../analytics/report.ts';
import { resolveWindow } from '../analytics/window.ts';
import type { Db } from '../persistence/db.ts';
import { timeZoneParam } from './time-zone-param.ts';
import { BadRequestError } from './validation.ts';

export interface AnalyticsRouteDeps {
  db: Db;
  workspaceId: string;
}

function requestWindow(req: Request): AnalyticsWindow {
  const query = analyticsQuerySchema.safeParse(req.query);
  if (!query.success) {
    throw new BadRequestError(
      'Pass range 7d, 30d or 90d, or range custom with from and to dates (YYYY-MM-DD).',
    );
  }
  const window = resolveWindow(query.data, timeZoneParam(req.query.tz));
  if (!window) throw new BadRequestError('A custom range can cover at most 366 days.');
  return window;
}

export function analyticsRoutes({ db, workspaceId }: AnalyticsRouteDeps): Router {
  const router = Router();

  router.get('/analytics/overview', async (req, res) => {
    res.json(await overviewReport(db, workspaceId, requestWindow(req)));
  });

  router.get('/analytics/spend', async (req, res) => {
    res.json(await spendReport(db, workspaceId, requestWindow(req)));
  });

  router.get('/analytics/harness', async (req, res) => {
    res.json(await harnessReport(db, workspaceId, requestWindow(req)));
  });

  router.get('/analytics/rollups', async (req, res) => {
    const window = requestWindow(req);
    const query = rollupQuerySchema.safeParse(req.query);
    if (!query.success) {
      throw new BadRequestError(
        'Pass groupBy day, project, provider, model, category or jev_decision.',
      );
    }
    res.json(await rollupReport(db, workspaceId, window, query.data.groupBy));
  });

  return router;
}
