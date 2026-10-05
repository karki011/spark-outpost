import { Router } from 'express';
import { continueRunRequestSchema } from '@spark-outpost/contracts';
import type { Db } from '../persistence/db.ts';
import { InterruptedRunNotFoundError, InterruptionError } from '../persistence/interruptions.ts';
import {
  continueInterruptedRun,
  interruptedConversation,
  startFreshAfterInterruption,
} from '../workflow/interruption-choice.ts';
import { resolveRunTarget, type RunTargetDeps } from './run-target.ts';
import { paramId, parseBody } from './validation.ts';

export interface InterruptionRouteDeps extends RunTargetDeps {
  db: Db;
}

export function interruptionRoutes(deps: InterruptionRouteDeps): Router {
  const { db, workspaceId } = deps;
  const router = Router();

  router.post('/runs/:id/continue', async (req, res) => {
    const { id } = parseBody(continueRunRequestSchema, req);
    const runId = paramId(req);
    const conversationId = await interruptedConversation(db, workspaceId, runId);
    const target = await resolveRunTarget(deps, conversationId);
    res.status(201).json(await continueInterruptedRun(db, workspaceId, runId, id, target));
  });

  router.post('/runs/:id/start-fresh', async (req, res) => {
    res.json(await startFreshAfterInterruption(db, workspaceId, paramId(req)));
  });

  return router;
}

export function interruptionErrorStatus(
  error: unknown,
): { status: number; message: string } | null {
  if (error instanceof InterruptedRunNotFoundError) return { status: 404, message: error.message };
  if (error instanceof InterruptionError) return { status: 409, message: error.message };
  return null;
}
