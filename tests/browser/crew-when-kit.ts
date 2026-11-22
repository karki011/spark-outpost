import type { Page, Route } from '@playwright/test';
import {
  workflowScheduleSchema,
  type WorkflowSchedule,
} from '../../packages/contracts/src/crew-schedule.ts';
import {
  workflowTriggersSchema,
  type WorkflowTriggers,
} from '../../packages/contracts/src/crew-triggers.ts';

export interface FakeWhenApi {
  schedules: Map<string, WorkflowSchedule>;
  scheduleSaves: WorkflowSchedule[];
  triggers: Map<string, WorkflowTriggers>;
  triggerSaves: WorkflowTriggers[];
  slots: unknown[];
  events: unknown[];
  holds: unknown[];
  released: string[];
  lastRunCostUsd: number | null;
  scheduleFailure: string | null;
}

const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const workflowOf = (route: Route) => new URL(route.request().url()).pathname.split('/').at(-2)!;

export async function fakeWhenApi(page: Page, log: string[]): Promise<FakeWhenApi> {
  const api: FakeWhenApi = {
    schedules: new Map(),
    scheduleSaves: [],
    triggers: new Map(),
    triggerSaves: [],
    slots: [],
    events: [],
    holds: [],
    released: [],
    lastRunCostUsd: null,
    scheduleFailure: null,
  };

  await page.route('**/api/workflow-schedules', (route) =>
    json(route, 200, {
      schedules: [...api.schedules].map(([workflowId, schedule]) => ({ workflowId, schedule })),
    }),
  );
  await page.route('**/api/workflow-triggers', (route) =>
    json(route, 200, {
      triggers: [...api.triggers].map(([workflowId, triggers]) => ({ workflowId, triggers })),
    }),
  );
  await page.route('**/api/workflows/*/schedule/slots', (route) =>
    json(route, 200, { slots: api.slots }),
  );
  await page.route('**/api/workflows/*/schedule', async (route) => {
    const id = workflowOf(route);
    if (route.request().method() === 'PUT') {
      log.push('schedule');
      if (api.scheduleFailure) return json(route, 400, { error: api.scheduleFailure });
      const schedule = workflowScheduleSchema.parse(route.request().postDataJSON());
      api.scheduleSaves.push(schedule);
      api.schedules.set(id, schedule);
    }
    return json(route, 200, {
      schedule: api.schedules.get(id) ?? null,
      conversationId: null,
      lastRunCostUsd: api.lastRunCostUsd,
    });
  });
  await page.route('**/api/workflows/*/triggers', async (route) => {
    const id = workflowOf(route);
    if (route.request().method() === 'PUT') {
      log.push('triggers');
      const triggers = workflowTriggersSchema.parse(route.request().postDataJSON());
      api.triggerSaves.push(triggers);
      api.triggers.set(id, triggers);
    }
    await json(route, 200, {
      triggers: api.triggers.get(id) ?? null,
      events: api.events,
      holds: api.holds,
    });
  });
  await page.route('**/api/workflow-holds/*/release', async (route) => {
    const holdId = workflowOf(route);
    api.released.push(holdId);
    api.holds = api.holds.filter((hold) => (hold as { id: string }).id !== holdId);
    await route.fulfill({ status: 204 });
  });
  return api;
}
