import { Router } from 'express';
import { savePlanRequestSchema, type AgreedPlans } from '@spark-outpost/contracts';
import { conversationRoots } from '../persistence/conversation-projects.ts';
import type { Db, Queryable } from '../persistence/db.ts';
import { assistantMessage, planDocuments } from '../persistence/plan-documents.ts';
import { saveAgreedMessage } from '../plans/agreed-plans.ts';
import { staleFiles } from '../plans/plan-staleness.ts';
import { paramId, parseBody } from './validation.ts';

export interface PlanRouteDeps {
  db: Db;
}

export async function agreedPlans(db: Queryable, conversationId: string): Promise<AgreedPlans> {
  const documents = await planDocuments(db, conversationId);
  const approved = documents.findLast((document) => document.status === 'approved');
  if (!approved) return { documents, staleFiles: [] };
  const [root] = await conversationRoots(db, conversationId);
  return { documents, staleFiles: await staleFiles(root ?? null, approved) };
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
