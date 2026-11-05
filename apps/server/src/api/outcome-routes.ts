import { Router } from 'express';
import { outcomeQuerySchema, saveFeedbackRequestSchema } from '@spark-outpost/contracts';
import type { Db } from '../persistence/db.ts';
import { outcomeReport } from '../persistence/outcome-report.ts';
import {
  OutcomeNotFinishedError,
  OutcomeNotFoundError,
  recordFeedback,
  refreshOutcome,
} from '../outcomes/record.ts';
import { BadRequestError, paramId, parseBody } from './validation.ts';

export interface OutcomeRouteDeps {
  db: Db;
  workspaceId: string;
  outcomeSampleRate?: number;
}

export function outcomeRoutes({ db, workspaceId, outcomeSampleRate }: OutcomeRouteDeps): Router {
  const router = Router();
  const options = outcomeSampleRate === undefined ? {} : { sampleRate: outcomeSampleRate };

  router.get('/runs/:id/outcome', async (req, res) => {
    res.json({ outcome: await refreshOutcome(db, workspaceId, paramId(req), options) });
  });

  router.put('/runs/:id/feedback', async (req, res) => {
    const request = parseBody(saveFeedbackRequestSchema, req);
    res.json({ outcome: await recordFeedback(db, workspaceId, paramId(req), request, options) });
  });

  router.get('/analytics/outcomes', async (req, res) => {
    const query = outcomeQuerySchema.safeParse(req.query);
    if (!query.success) throw new BadRequestError('Pass a known groupBy and days from 1 to 365.');
    res.json(await outcomeReport(db, workspaceId, query.data.groupBy, query.data.days));
  });

  return router;
}

export function outcomeErrorStatus(error: unknown): { status: number; message: string } | null {
  if (error instanceof OutcomeNotFoundError) return { status: 404, message: error.message };
  if (error instanceof OutcomeNotFinishedError) return { status: 409, message: error.message };
  return null;
}
