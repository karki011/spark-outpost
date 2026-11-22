import { Router, type Request } from 'express';
import {
  crewSlugSchema,
  workflowTriggersSchema,
  type WorkflowTriggersList,
  type WorkflowTriggersView,
} from '@spark-outpost/contracts';
import { z } from 'zod';
import { parseBody } from '../api/validation.ts';
import type { Db } from '../persistence/db.ts';
import { listHolds, PublishHoldNotFoundError, releaseHold } from './publish-holds.ts';
import { deleteTriggers, getTriggers, listTriggerEvents, listTriggers } from './trigger-records.ts';
import { setWorkflowTriggers } from './workflow-settings.ts';
import { WorkflowNotFoundError, workflowStore, type WorkflowStore } from './workflow-store.ts';

export interface TriggerRouteDeps {
  db: Db;
  workspaceId: string;
  workflows?: WorkflowStore;
}

function workflowId(req: Request): string {
  const parsed = crewSlugSchema.safeParse(req.params.id);
  if (!parsed.success) throw new WorkflowNotFoundError(String(req.params.id));
  return parsed.data;
}

export function triggerRoutes(deps: TriggerRouteDeps): Router {
  const { db, workspaceId } = deps;
  const store = deps.workflows ?? workflowStore();
  const router = Router();

  const existing = async (req: Request): Promise<string> => {
    const id = workflowId(req);
    if ((await store.read(id)) === null) throw new WorkflowNotFoundError(id);
    return id;
  };

  const view = async (id: string): Promise<WorkflowTriggersView> => ({
    triggers: (await getTriggers(db, workspaceId, id))?.triggers ?? null,
    events: await listTriggerEvents(db, workspaceId, id),
    holds: await listHolds(db, workspaceId, id),
  });

  router.get('/workflow-triggers', async (_req, res) => {
    const body: WorkflowTriggersList = { triggers: await listTriggers(db, workspaceId) };
    res.json(body);
  });

  router.get('/workflows/:id/triggers', async (req, res) => {
    res.json(await view(await existing(req)));
  });

  router.put('/workflows/:id/triggers', async (req, res) => {
    const id = await existing(req);
    await setWorkflowTriggers(db, workspaceId, id, parseBody(workflowTriggersSchema, req));
    res.json(await view(id));
  });

  router.delete('/workflows/:id/triggers', async (req, res) => {
    await deleteTriggers(db, workspaceId, workflowId(req));
    res.status(204).end();
  });

  router.post('/workflow-holds/:id/release', async (req, res) => {
    const id = z.uuid().safeParse(req.params.id);
    if (!id.success || !(await releaseHold(db, workspaceId, id.data))) {
      throw new PublishHoldNotFoundError();
    }
    res.status(204).end();
  });

  return router;
}
