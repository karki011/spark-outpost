import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AttentionList, ScheduleSlots, WorkflowScheduleView } from '@spark-outpost/contracts';
import { getSchedule } from '../src/crew-flows/schedule-records.ts';
import { ROUTE_RULES } from '../src/remote/route-rules.ts';
import { setSparkPaused } from '../src/persistence/spark-pause.ts';
import { createProject } from '../src/projects/projects.ts';
import { createTestApp, localClient } from './app-support.ts';
import {
  at,
  everyHalfHour,
  finishRun,
  FLOW,
  runsOf,
  schedulerClock,
} from './crew-schedule-support.ts';
import { newSpark, saveFlow, step, useWorkflowsDir } from './crew-workflow-support.ts';
import { createTestDb, type TestDb } from './support.ts';
import { gitRepo, removeRepo } from './turn-support.ts';
import { connectAgents } from './turn-worker.ts';

let t: TestDb;
let root: string;
let client: ReturnType<typeof localClient>;
let dropWorkflows: () => Promise<void>;

beforeEach(async () => {
  t = await createTestDb();
  root = await gitRepo();
  dropWorkflows = await useWorkflowsDir();
  await connectAgents(t);
  client = localClient(createTestApp(t));
  const pip = await newSpark(t, 'Pip');
  await saveFlow(t, FLOW, [step('review', pip.id)]);
});

afterEach(async () => {
  await t.cleanup();
  await removeRepo(root);
  await dropWorkflows();
});

const path = `/api/workflows/${FLOW}/schedule`;

describe('schedule routes', () => {
  it('saves, reads, lists and deletes the schedule of a workflow', async () => {
    const { project } = await createProject(t.db, t.workspaceId, root);
    const empty = await client.get(path).expect(200);
    expect(empty.body).toEqual({ schedule: null, conversationId: null, lastRunCostUsd: null });

    const schedule = everyHalfHour({ projectId: project.id, days: [1, 2, 3, 4, 5] });
    const saved = await client.send('put', path, schedule).expect(200);
    expect((saved.body as WorkflowScheduleView).schedule).toEqual(schedule);
    expect((await client.get(path).expect(200)).body).toEqual(saved.body);
    expect((await client.get('/api/workflow-schedules').expect(200)).body).toEqual({
      schedules: [{ workflowId: FLOW, schedule }],
    });

    await client.send('put', path, { ...schedule, enabled: false }).expect(200);
    expect((await getSchedule(t.db, t.workspaceId, FLOW))?.schedule.enabled).toBe(false);

    await client.send('delete', path).expect(204);
    expect((await client.get(path).expect(200)).body.schedule).toBeNull();
  });

  it('refuses a schedule it cannot run', async () => {
    await client.send('put', path, { ...everyHalfHour(), every: 0 }).expect(400);
    await client.send('put', path, { ...everyHalfHour(), unit: 'cron' }).expect(400);
    await client.send('put', path, { ...everyHalfHour(), projectId: randomUUID() }).expect(400);
    await client.send('put', '/api/workflows/no-such-flow/schedule', everyHalfHour()).expect(404);
    await client.get('/api/workflows/no-such-flow/schedule').expect(404);
  });

  it('deletes the schedule with its workflow', async () => {
    await client.send('put', path, everyHalfHour()).expect(200);
    await client.send('delete', `/api/workflows/${FLOW}`).expect(204);
    expect(await getSchedule(t.db, t.workspaceId, FLOW)).toBeNull();
  });

  it('lists skipped and held slots beside the runs, with the cost of the last run', async () => {
    const clock = schedulerClock(t, at(9, 10));
    await clock.save(everyHalfHour());
    await clock.checkAt(at(9, 30));
    const [run] = await runsOf(t);
    await clock.checkAt(at(10, 0));
    await finishRun(t, run!);
    await t.db.query('UPDATE runs SET cost_usd = 0.42 WHERE id = $1', [run!.runId]);
    await setSparkPaused(t.db, t.workspaceId, true);
    await clock.checkAt(at(10, 30));

    const { slots } = (await client.get(`${path}/slots`).expect(200)).body as ScheduleSlots;
    expect(
      slots.map(({ state, reason, workflowRunId }) => ({ state, reason, workflowRunId })),
    ).toEqual([
      { state: 'held', reason: 'paused', workflowRunId: null },
      { state: 'skipped', reason: 'previous_running', workflowRunId: null },
      { state: 'started', reason: null, workflowRunId: run!.id },
    ]);
    const runs = (await client.get(`/api/workflows/${FLOW}/runs`).expect(200)).body.runs;
    expect(runs).toMatchObject([{ id: run!.id, source: 'schedule' }]);
    const view = (await client.get(path).expect(200)).body as WorkflowScheduleView;
    expect(view).toMatchObject({ conversationId: run!.conversationId, lastRunCostUsd: 0.42 });
  });

  it('keeps every schedule route on the Mac', () => {
    const routes = [
      'GET /api/workflow-schedules',
      'GET /api/workflows/:id/schedule',
      'PUT /api/workflows/:id/schedule',
      'DELETE /api/workflows/:id/schedule',
      'GET /api/workflows/:id/schedule/slots',
    ];
    for (const route of routes) expect(ROUTE_RULES.get(route), route).toBe('never');
  });
});

describe('scheduled runs in the attention state', () => {
  it('groups a schedule into one update line, singles out a failure and never blocks', async () => {
    const clock = schedulerClock(t, new Date(Date.now() - 3 * 60 * 60_000));
    const start = clock.deps.now();
    await clock.save(everyHalfHour({ from: '00:00', to: null }));
    const step30 = (count: number) => new Date(start.getTime() + count * 30 * 60_000);
    await clock.checkAt(step30(1));
    const [failed] = await runsOf(t);
    await finishRun(t, failed!, 'failed');
    await clock.checkAt(step30(2));
    const [latest] = await runsOf(t);
    await finishRun(t, latest!);

    const { items } = (await client.get('/api/attention').expect(200)).body as AttentionList;

    expect(items.every((item) => !item.blocking)).toBe(true);
    const grouped = items.find((item) => item.key === `run-done:${latest!.runId}`);
    const dayStart = new Date().setHours(0, 0, 0, 0);
    const today = [failed!, latest!].filter((run) => Date.parse(run.startedAt) >= dayStart);
    expect(grouped?.schedule).toEqual({
      workflowId: FLOW,
      name: `Flow ${FLOW}`,
      runsToday: today.length,
      failedToday: today.includes(failed!) ? 1 : 0,
    });
    const single = items.find((item) => item.key === `run-failed:${failed!.runId}`);
    expect(single === undefined).toBe(!today.includes(failed!));
    expect(single?.schedule ?? null).toBeNull();
  });
});
