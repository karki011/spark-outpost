import { Router } from 'express';
import { approvalDecisionRequestSchema, railFlagDecisionSchema } from '@spark-outpost/contracts';
import type { Db } from '../persistence/db.ts';
import {
  ApprovalConflictError,
  ApprovalInputError,
  ApprovalNotFoundError,
  decideApproval,
  holdApproval,
} from '../persistence/approvals.ts';
import { retrySparkAction } from '../persistence/spark-results.ts';
import {
  RevertConflictError,
  RunNotFoundError,
  revertRun,
  runChanges,
} from '../projects/run-changes.ts';
import { decideRailFlag } from '../projects/rail-flag-decision.ts';
import { RailFlagNotFoundError } from '../persistence/rail-flags.ts';
import { paramId, parseBody } from './validation.ts';
import { auditCrewDenial } from '../crew/crew-edit-audit.ts';
import { RulesFileError } from '../spark-rules/rules-file.ts';

export interface ApprovalRouteDeps {
  db: Db;
  workspaceId: string;
}

export function approvalRoutes({ db, workspaceId }: ApprovalRouteDeps): Router {
  const router = Router();

  router.post('/approvals/:id/decision', async (req, res) => {
    const decision = parseBody(approvalDecisionRequestSchema, req);
    const decided = await decideApproval(db, workspaceId, paramId(req), decision);
    await auditCrewDenial(db, decided);
    res.json(decided);
  });

  router.post('/approvals/:id/hold', async (req, res) => {
    res.json(await holdApproval(db, workspaceId, paramId(req)));
  });

  router.post('/approvals/:id/retry', async (req, res) => {
    res.json(await retrySparkAction(db, workspaceId, paramId(req)));
  });

  router.get('/runs/:id/changes', async (req, res) => {
    res.json(await runChanges(db, workspaceId, paramId(req)));
  });

  router.post('/runs/:id/revert', async (req, res) => {
    res.json(await revertRun(db, workspaceId, paramId(req)));
  });

  router.post('/rail-flags/:id/decision', async (req, res) => {
    const decision = parseBody(railFlagDecisionSchema, req);
    res.json(await decideRailFlag(db, workspaceId, paramId(req), decision));
  });

  return router;
}

export function approvalErrorStatus(error: unknown): { status: number; message: string } | null {
  if (error instanceof ApprovalInputError) return { status: 400, message: error.message };
  if (
    error instanceof ApprovalNotFoundError ||
    error instanceof RunNotFoundError ||
    error instanceof RailFlagNotFoundError
  ) {
    return { status: 404, message: error.message };
  }
  if (
    error instanceof ApprovalConflictError ||
    error instanceof RevertConflictError ||
    error instanceof RulesFileError
  ) {
    return { status: 409, message: error.message };
  }
  return null;
}
