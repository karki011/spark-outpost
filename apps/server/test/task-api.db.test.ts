import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { taskDetailSchema, taskOverviewSchema } from '@spark-outpost/contracts';
import { getRun } from '../src/persistence/runs.ts';
import { FAKE_PR_URL, createFakeProvider } from '../src/providers/fake.ts';
import { startWorker, type Worker } from '../src/workflow/worker.ts';
import { createTestApp, ORIGIN, LOCAL_HEADERS } from './app-support.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

let t: TestDb;
let worker: Worker;
let app: ReturnType<typeof createTestApp>;

const conversationTasksSchema = z.object({ tasks: z.array(taskOverviewSchema) });

beforeEach(async () => {
  t = await createTestDb();
  const provider = createFakeProvider({ stepMs: 0, wordMs: 0 });
  worker = startWorker({
    db: t.db,
    providers: new Map([[provider.name, provider]]),
    leaseSeconds: 30,
    concurrency: 1,
    pollMs: 20,
  });
  app = createTestApp(t);
});

afterEach(async () => {
  await worker.stop();
  await t.cleanup();
});

const post = (path: string, body: object) =>
  request(app).post(path).set(LOCAL_HEADERS).set('Origin', ORIGIN).send(body);
const get = (path: string) => request(app).get(path).set(LOCAL_HEADERS);

async function plannedTask(): Promise<{ conversationId: string; taskId: string }> {
  const conversationId = randomUUID();
  await post('/api/conversations', { id: conversationId }).expect(201);
  const sent = await post(`/api/conversations/${conversationId}/messages`, {
    id: randomUUID(),
    content: 'Fix the divider #plan',
  }).expect(201);
  await eventually(async () => (await getRun(t.db, sent.body.run.id as string))?.finishedAt);
  const detail = conversationTasksSchema.parse(
    (await get(`/api/conversations/${conversationId}`).expect(200)).body,
  );
  return { conversationId, taskId: detail.tasks[0]!.id };
}

describe('task API', () => {
  it('returns the task with its list, plan versions and links', async () => {
    const { conversationId, taskId } = await plannedTask();
    const detail = conversationTasksSchema.parse(
      (await get(`/api/conversations/${conversationId}`).expect(200)).body,
    );
    expect(detail.tasks[0]!.summary.text).toMatch(/^\d+ of \d+ done$/);

    const task = taskDetailSchema.parse((await get(`/api/tasks/${taskId}`).expect(200)).body);
    expect(task.planVersions).toHaveLength(1);
    expect(task.links.map((link) => link.url)).toEqual([FAKE_PR_URL]);
    expect(task.runs).toHaveLength(1);
    expect(task.runs[0]).not.toHaveProperty('request');
    expect(task.items.map((item) => item.label)).toEqual([
      'Understood the request',
      'Made a plan',
      'Read the request',
      'Look through the code',
      'Write the answer',
      'Worked on the request',
      'Opened spark-outpost/demo#42',
    ]);
  });

  it('adds a link, classifies pull requests and ignores duplicates', async () => {
    const { taskId } = await plannedTask();
    const added = await post(`/api/tasks/${taskId}/links`, {
      url: 'https://github.com/acme/web/pull/7/files',
    }).expect(201);
    expect(added.body).toMatchObject({ kind: 'pr', title: 'acme/web#7', source: 'user' });

    const docs = await post(`/api/tasks/${taskId}/links`, {
      url: 'https://example.com/spec',
      title: '  Spec  ',
    }).expect(201);
    expect(docs.body).toMatchObject({ kind: 'link', title: 'Spec' });

    const again = await post(`/api/tasks/${taskId}/links`, { url: FAKE_PR_URL }).expect(200);
    expect(again.body.source).toBe('agent_text');
  });

  it('refuses unsafe links and unknown tasks', async () => {
    const { taskId } = await plannedTask();
    await post(`/api/tasks/${taskId}/links`, { url: 'javascript:alert(1)' }).expect(400);
    await post(`/api/tasks/${taskId}/links`, { url: 'not a url' }).expect(400);
    await post(`/api/tasks/${randomUUID()}/links`, { url: 'https://example.com' }).expect(404);
    await get(`/api/tasks/${randomUUID()}`).expect(404);
    await get('/api/tasks/nope').expect(400);
  });

  it('downloads the plan as Markdown', async () => {
    const { taskId } = await plannedTask();
    const response = await get(`/api/tasks/${taskId}/artifacts/plan.md`).expect(200);
    expect(response.headers['content-type']).toContain('text/markdown');
    expect(response.headers['content-disposition']).toContain('plan.md');
    expect(response.text).toContain('# Plan v1');
    expect(response.text).toContain('- [x] Write the answer · low priority');
    await get(`/api/tasks/${taskId}/artifacts/secret.md`).expect(404);
  });
});
