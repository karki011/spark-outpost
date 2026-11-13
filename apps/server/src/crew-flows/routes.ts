import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  crewSlugSchema,
  saveWorkflowSchema,
  startBuilderChatSchema,
  startSparkTestRunSchema,
  startWorkflowRunSchema,
} from '@spark-outpost/contracts';
import { resolveRunTarget } from '../api/run-target.ts';
import { BadRequestError, paramId, parseBody } from '../api/validation.ts';
import type { Db } from '../persistence/db.ts';
import { newId } from '../persistence/ids.ts';
import { requestCancel } from '../persistence/runs.ts';
import {
  BuilderChatNotFoundError,
  BuilderChatTakenError,
  currentBuilderChat,
  markBuilderDone,
  startBuilderChat,
} from './builder-chat.ts';
import { getWorkflowRun, listWorkflowRuns } from './run-records.ts';
import { deleteSchedule } from './schedule-records.ts';
import { SparkNotFoundError, startSparkTestRun, startWorkflowRun } from './start-run.ts';
import { TestRunNotFoundError, discardTestRun, readTestRun } from './test-run.ts';
import { workspaceSparkIds } from './step-sparks.ts';
import {
  WorkflowChangedError,
  WorkflowExistsError,
  WorkflowNotFoundError,
  WorkflowProblemsError,
  workflowStore,
  type WorkflowStore,
} from './workflow-store.ts';

export const IDEMPOTENCY_HEADER = 'idempotency-key';

export interface WorkflowRouteDeps {
  db: Db;
  workspaceId: string;
  fixedRunProvider?: string;
  workflows?: WorkflowStore;
  chatFolders?: string;
  deleteSettleMs?: number;
}

export class WorkflowRunNotFoundError extends Error {
  constructor() {
    super('That workflow run does not exist.');
  }
}

export function workflowErrorStatus(error: unknown): { status: number; message: string } | null {
  if (
    error instanceof WorkflowNotFoundError ||
    error instanceof WorkflowRunNotFoundError ||
    error instanceof TestRunNotFoundError ||
    error instanceof BuilderChatNotFoundError ||
    error instanceof SparkNotFoundError
  ) {
    return { status: 404, message: error.message };
  }
  if (
    error instanceof WorkflowChangedError ||
    error instanceof WorkflowExistsError ||
    error instanceof BuilderChatTakenError
  ) {
    return { status: 409, message: error.message };
  }
  if (error instanceof WorkflowProblemsError) return { status: 400, message: error.message };
  return null;
}

function workflowId(req: Request): string {
  const parsed = crewSlugSchema.safeParse(req.params.id);
  if (!parsed.success) throw new WorkflowNotFoundError(String(req.params.id));
  return parsed.data;
}

function messageId(req: Request): string {
  const key = req.get(IDEMPOTENCY_HEADER);
  if (key === undefined) return newId();
  const parsed = z.uuid().safeParse(key);
  if (!parsed.success) throw new BadRequestError('Idempotency-Key must be a UUID.');
  return parsed.data;
}

export function workflowRoutes(deps: WorkflowRouteDeps): Router {
  const { db, workspaceId, fixedRunProvider } = deps;
  const store = deps.workflows ?? workflowStore();
  const router = Router();
  const sparkIds = () => workspaceSparkIds(db, workspaceId);
  const runs = {
    db,
    workspaceId,
    store,
    runTarget: (conversationId: string) =>
      resolveRunTarget({ db, workspaceId, fixedRunProvider }, conversationId),
    chatFolders: deps.chatFolders,
    deleteSettleMs: deps.deleteSettleMs,
  };

  router.get('/workflows', async (_req, res) => {
    res.json({ workflows: await store.list(await sparkIds()) });
  });

  router.get('/workflows/:id', async (req, res) => {
    const id = workflowId(req);
    const file = await store.read(id);
    if (!file) throw new WorkflowNotFoundError(id);
    res.json(file);
  });

  router.put('/workflows/:id', async (req, res) => {
    const id = workflowId(req);
    const { workflow, baseHash } = parseBody(saveWorkflowSchema, req);
    if (workflow.id !== id)
      throw new BadRequestError('The workflow id does not match the address.');
    res.json(await store.save(workflow, baseHash, await sparkIds()));
  });

  router.delete('/workflows/:id', async (req, res) => {
    const id = workflowId(req);
    await store.remove(id);
    await deleteSchedule(db, workspaceId, id);
    res.status(204).end();
  });

  router.get('/workflows/:id/runs', async (req, res) => {
    res.json({ runs: await listWorkflowRuns(db, workspaceId, workflowId(req)) });
  });

  router.post('/workflows/:id/runs', async (req, res) => {
    const run = await startWorkflowRun(runs, {
      ...parseBody(startWorkflowRunSchema, req),
      workflowId: workflowId(req),
      messageId: messageId(req),
      source: 'manual',
    });
    res.status(201).json(run);
  });

  router.post('/teammates/:id/test-runs', async (req, res) => {
    const run = await startSparkTestRun(runs, {
      ...parseBody(startSparkTestRunSchema, req),
      sparkId: paramId(req),
      messageId: messageId(req),
    });
    res.status(201).json(run);
  });

  router.get('/workflow-runs/:id/test', async (req, res) => {
    res.json(await readTestRun(runs, paramId(req)));
  });

  router.delete('/workflow-runs/:id', async (req, res) => {
    await discardTestRun(runs, paramId(req));
    res.status(204).end();
  });

  router.get('/workflow-runs/:id', async (req, res) => {
    const run = await getWorkflowRun(db, workspaceId, paramId(req));
    if (!run) throw new WorkflowRunNotFoundError();
    res.json(run);
  });

  router.post('/workflow-runs/:id/stop', async (req, res) => {
    const id = paramId(req);
    const run = await getWorkflowRun(db, workspaceId, id);
    if (!run) throw new WorkflowRunNotFoundError();
    if (run.status === 'running' && run.runId) await requestCancel(db, run.runId);
    res.json((await getWorkflowRun(db, workspaceId, id)) ?? run);
  });

  router.get('/crew/builder', async (_req, res) => {
    res.json({ chat: await currentBuilderChat(runs) });
  });

  router.post('/crew/builder', async (req, res) => {
    const { id } = parseBody(startBuilderChatSchema, req);
    res.status(201).json(await startBuilderChat(runs, id));
  });

  router.post('/crew/builder/:id/done', async (req, res) => {
    res.json(await markBuilderDone(runs, paramId(req)));
  });

  return router;
}
