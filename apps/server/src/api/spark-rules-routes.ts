import { Router } from 'express';
import {
  sparkRuleAnswerRequestSchema,
  updateSparkRulesRequestSchema,
} from '@spark-outpost/contracts';
import type { Db } from '../persistence/db.ts';
import { saveSparkRules, sparkRules } from '../persistence/spark-rules.ts';
import type { ResolveTarget } from '../workflow/queue-drain.ts';
import { answerRuleCard } from '../workflow/spark-rule-cards.ts';
import { resolveRunTarget } from './run-target.ts';
import { paramId, parseBody } from './validation.ts';

export interface SparkRulesRouteDeps {
  db: Db;
  workspaceId: string;
  fixedRunProvider?: string;
}

export function sparkRulesRoutes({ db, workspaceId, fixedRunProvider }: SparkRulesRouteDeps) {
  const router = Router();
  const resolveTarget: ResolveTarget = (conversationId) =>
    resolveRunTarget({ db, workspaceId, fixedRunProvider }, conversationId);

  router.get('/spark-rules', async (_req, res) => {
    res.json(await sparkRules());
  });

  router.put('/spark-rules', async (req, res) => {
    const update = parseBody(updateSparkRulesRequestSchema, req);
    res.json(await saveSparkRules(update));
  });

  router.post('/approvals/:id/spark-rule', async (req, res) => {
    const { answer } = parseBody(sparkRuleAnswerRequestSchema, req);
    res.json(await answerRuleCard(db, workspaceId, paramId(req), answer, resolveTarget));
  });

  return router;
}
