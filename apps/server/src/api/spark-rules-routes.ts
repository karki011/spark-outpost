import { Router } from 'express';
import {
  ghAllowedRequestSchema,
  setSparkRuleRequestSchema,
  sparkRuleAnswerRequestSchema,
} from '@spark-outpost/contracts';
import type { Db } from '../persistence/db.ts';
import {
  setGhAllowed,
  setSparkRule,
  sparkRules,
  SparkRulesInputError,
  useRecommendedRules,
} from '../persistence/spark-rules.ts';
import { RulesFileError } from '../spark-rules/rules-file.ts';
import type { ResolveTarget } from '../workflow/queue-drain.ts';
import { answerRuleCard } from '../workflow/spark-rule-cards.ts';
import { resolveRunTarget } from './run-target.ts';
import { paramId, parseBody } from './validation.ts';

export interface SparkRulesRouteDeps {
  db: Db;
  workspaceId: string;
  fixedRunProvider?: string;
}

export function sparkRulesErrorStatus(error: unknown): { status: number; message: string } | null {
  if (error instanceof SparkRulesInputError) return { status: 400, message: error.message };
  if (error instanceof RulesFileError) return { status: 409, message: error.message };
  return null;
}

export function sparkRulesRoutes({ db, workspaceId, fixedRunProvider }: SparkRulesRouteDeps) {
  const router = Router();
  const resolveTarget: ResolveTarget = (conversationId) =>
    resolveRunTarget({ db, workspaceId, fixedRunProvider }, conversationId);

  router.get('/spark-rules', async (_req, res) => {
    res.json(await sparkRules(db, workspaceId));
  });

  router.put('/spark-rules/rule', async (req, res) => {
    const { row, choice } = parseBody(setSparkRuleRequestSchema, req);
    res.json(await setSparkRule(db, workspaceId, row, choice));
  });

  router.put('/spark-rules/gh-allowed', async (req, res) => {
    const { prefix, allowed } = parseBody(ghAllowedRequestSchema, req);
    res.json(await setGhAllowed(db, workspaceId, prefix, allowed));
  });

  router.post('/spark-rules/recommended', async (_req, res) => {
    res.json(await useRecommendedRules(db, workspaceId));
  });

  router.post('/approvals/:id/spark-rule', async (req, res) => {
    const { answer } = parseBody(sparkRuleAnswerRequestSchema, req);
    res.json(await answerRuleCard(db, workspaceId, paramId(req), answer, resolveTarget));
  });

  return router;
}
