import type { Page, Route } from '@playwright/test';
import {
  workflowScheduleSchema,
  type WorkflowSchedule,
} from '../../packages/contracts/src/crew-schedule.ts';

export interface FakeScheduleApi {
  schedules: Map<string, WorkflowSchedule>;
  saves: WorkflowSchedule[];
  runs: unknown[];
  slots: unknown[];
  lastRunCostUsd: number | null;
}

const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const workflowOf = (route: Route, fromEnd: number) =>
  new URL(route.request().url()).pathname.split('/').at(fromEnd)!;

export async function fakeScheduleApi(page: Page): Promise<FakeScheduleApi> {
  const api: FakeScheduleApi = {
    schedules: new Map(),
    saves: [],
    runs: [],
    slots: [],
    lastRunCostUsd: null,
  };
  const view = (id: string) => ({
    schedule: api.schedules.get(id) ?? null,
    conversationId: null,
    lastRunCostUsd: api.lastRunCostUsd,
  });

  await page.route('**/api/workflow-schedules', (route) =>
    json(route, 200, {
      schedules: [...api.schedules].map(([workflowId, schedule]) => ({ workflowId, schedule })),
    }),
  );
  await page.route('**/api/workflows/*/runs', (route) =>
    route.request().method() === 'GET' ? json(route, 200, { runs: api.runs }) : route.fallback(),
  );
  await page.route('**/api/workflows/*/schedule/slots', (route) =>
    json(route, 200, { slots: api.slots }),
  );
  await page.route('**/api/workflows/*/schedule', async (route) => {
    const id = workflowOf(route, -2);
    if (route.request().method() === 'PUT') {
      const schedule = workflowScheduleSchema.parse(route.request().postDataJSON());
      api.saves.push(schedule);
      api.schedules.set(id, schedule);
    }
    await json(route, 200, view(id));
  });
  return api;
}
