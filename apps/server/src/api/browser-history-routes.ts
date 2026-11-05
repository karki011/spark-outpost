import { Router } from 'express';
import {
  browserHistoryClearSchema,
  browserHistoryEventSchema,
  browserHistoryQuerySchema,
  historySince,
  type BrowserHistoryList,
} from '@spark-outpost/contracts';
import type { Db } from '../persistence/db.ts';
import { clearHistory, recordHistory, searchHistory } from '../persistence/browser-history.ts';
import { parseBody, parseQuery } from './validation.ts';

export interface BrowserHistoryRouteDeps {
  db: Db;
  workspaceId: string;
  now?: () => Date;
}

export function browserHistoryRoutes({ db, workspaceId, now }: BrowserHistoryRouteDeps): Router {
  const router = Router();

  router.post('/browser-history', async (req, res) => {
    await recordHistory(db, workspaceId, parseBody(browserHistoryEventSchema, req));
    res.status(204).end();
  });

  router.get('/browser-history', async (req, res) => {
    const query = parseQuery(browserHistoryQuerySchema, req);
    const entries = await searchHistory(db, workspaceId, query);
    res.json({ entries } satisfies BrowserHistoryList);
  });

  router.post('/browser-history/clear', async (req, res) => {
    const { profile, range } = parseBody(browserHistoryClearSchema, req);
    const since = historySince(range, now?.() ?? new Date());
    res.json({ removed: await clearHistory(db, workspaceId, profile, since) });
  });

  return router;
}
