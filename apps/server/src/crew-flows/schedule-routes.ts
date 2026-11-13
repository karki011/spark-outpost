import { Router, type Request } from 'express';
import {
  crewSlugSchema,
  workflowScheduleSchema,
  type ScheduleSlots,
  type WorkflowScheduleView,
  type WorkflowSchedules,
} from '@spark-outpost/contracts';
import { BadRequestError, parseBody } from '../api/validation.ts';
import type { Db } from '../persistence/db.ts';
import {
  deleteSchedule,
  getSchedule,
  lastRunCostUsd,
  listScheduleSlots,
  listSchedules,
  projectLinked,
  saveSchedule,
} from './schedule-records.ts';
import { WorkflowNotFoundError, workflowStore, type WorkflowStore } from './workflow-store.ts';

export interface ScheduleRouteDeps {
  db: Db;
  workspaceId: string;
  workflows?: WorkflowStore;
  now?: () => Date;
}

function workflowId(req: Request): string {
  const parsed = crewSlugSchema.safeParse(req.params.id);
  if (!parsed.success) throw new WorkflowNotFoundError(String(req.params.id));
  return parsed.data;
}

export function scheduleRoutes(deps: ScheduleRouteDeps): Router {
  const { db, workspaceId } = deps;
  const store = deps.workflows ?? workflowStore();
  const now = deps.now ?? (() => new Date());
  const router = Router();

  const existing = async (req: Request): Promise<string> => {
    const id = workflowId(req);
    if ((await store.read(id)) === null) throw new WorkflowNotFoundError(id);
    return id;
  };

  const view = async (id: string): Promise<WorkflowScheduleView> => {
    const stored = await getSchedule(db, workspaceId, id);
    return {
      schedule: stored?.schedule ?? null,
      conversationId: stored?.conversationId ?? null,
      lastRunCostUsd: await lastRunCostUsd(db, workspaceId, id),
    };
  };

  router.get('/workflow-schedules', async (_req, res) => {
    const schedules = await listSchedules(db, workspaceId);
    const body: WorkflowSchedules = {
      schedules: schedules.map(({ workflowId: id, schedule }) => ({ workflowId: id, schedule })),
    };
    res.json(body);
  });

  router.get('/workflows/:id/schedule', async (req, res) => {
    res.json(await view(await existing(req)));
  });

  router.put('/workflows/:id/schedule', async (req, res) => {
    const id = await existing(req);
    const schedule = parseBody(workflowScheduleSchema, req);
    if (schedule.projectId !== null && !(await projectLinked(db, workspaceId, schedule.projectId))) {
      throw new BadRequestError('That project is not in Spark.');
    }
    await saveSchedule(db, workspaceId, id, schedule, now());
    res.json(await view(id));
  });

  router.delete('/workflows/:id/schedule', async (req, res) => {
    await deleteSchedule(db, workspaceId, workflowId(req));
    res.status(204).end();
  });

  router.get('/workflows/:id/schedule/slots', async (req, res) => {
    const body: ScheduleSlots = { slots: await listScheduleSlots(db, workspaceId, workflowId(req)) };
    res.json(body);
  });

  return router;
}
