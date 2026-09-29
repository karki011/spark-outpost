import { Router } from 'express';
import { savePlanRequestSchema } from '@spark-outpost/contracts';
import { conversationRoots } from '../persistence/conversation-projects.ts';
import type { Db } from '../persistence/db.ts';
import { assistantMessage } from '../persistence/plan-documents.ts';
import { saveAgreedMessage } from '../plans/agreed-plans.ts';
import { paramId, parseBody } from './validation.ts';

export interface PlanRouteDeps {
  db: Db;
}

export function planRoutes({ db }: PlanRouteDeps): Router {
  const router = Router();

  router.post('/conversations/:id/plans', async (req, res) => {
    const conversationId = paramId(req);
    const { messageId, offered } = parseBody(savePlanRequestSchema, req);
    const message = await assistantMessage(db, conversationId, messageId);
    if (!message) {
      res.status(404).json({ error: 'That reply is not in this conversation.' });
      return;
    }
    const [root] = await conversationRoots(db, conversationId);
    const plan = await saveAgreedMessage(db, message, {
      by: 'user',
      source: offered ? 'chat' : 'user',
      root: root ?? null,
      approvedRunId: null,
    });
    res.status(201).json(plan);
  });

  return router;
}
