import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ConversationSummary, Project } from '@spark-outpost/contracts';
import { sendUserMessage } from '../src/persistence/conversations.ts';
import { createTestApp, ORIGIN, LOCAL_HEADERS } from './app-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let app: ReturnType<typeof createTestApp>;
let base: string;

beforeAll(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'spark-order-')));
  for (const name of ['alpha', 'beta', 'gamma']) await mkdir(join(base, name));
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

beforeEach(async () => {
  t = await createTestDb();
  app = createTestApp(t);
});

afterEach(async () => {
  await t.cleanup();
});

const put = (path: string, body: unknown) =>
  request(app)
    .put(path)
    .set(LOCAL_HEADERS)
    .set('Origin', ORIGIN)
    .send(body as object);

async function project(name: string): Promise<Project> {
  const response = await request(app)
    .post('/api/projects')
    .set(LOCAL_HEADERS)
    .set('Origin', ORIGIN)
    .send({ rootPath: join(base, name) })
    .expect(201);
  return response.body as Project;
}

async function chat(content: string, projectId: string): Promise<string> {
  const id = randomUUID();
  await sendUserMessage(
    t.db,
    id,
    { id: randomUUID(), content },
    { provider: 'fake' },
    t.workspaceId,
  );
  await request(app)
    .patch(`/api/conversations/${id}/settings`)
    .set(LOCAL_HEADERS)
    .send({ projectIds: [projectId] })
    .expect(200);
  return id;
}

async function projectNames(): Promise<string[]> {
  const response = await request(app).get('/api/projects').set(LOCAL_HEADERS).expect(200);
  return (response.body as Project[]).map((entry) => entry.name);
}

async function projectOrders(): Promise<Record<string, number | null>> {
  const response = await request(app).get('/api/conversations').set(LOCAL_HEADERS).expect(200);
  const chats = response.body as ConversationSummary[];
  return Object.fromEntries(chats.map((entry) => [entry.title, entry.projectOrder]));
}

describe('sidebar order', () => {
  it('lists projects by name until they are ordered, then keeps new ones last', async () => {
    const gamma = await project('gamma');
    const alpha = await project('alpha');
    expect(await projectNames()).toEqual(['alpha', 'gamma']);

    await put('/api/projects/order', { projectIds: [gamma.id, alpha.id] }).expect(204);
    await project('beta');
    expect(await projectNames()).toEqual(['gamma', 'alpha', 'beta']);
  });

  it('orders chats inside one project and ignores chats from elsewhere', async () => {
    const alpha = await project('alpha');
    const beta = await project('beta');
    const first = await chat('First', alpha.id);
    const second = await chat('Second', alpha.id);
    const other = await chat('Other', beta.id);
    expect(await projectOrders()).toEqual({ First: null, Second: null, Other: null });

    await put(`/api/projects/${alpha.id}/chat-order`, {
      conversationIds: [second, first, other],
    }).expect(204);
    expect(await projectOrders()).toEqual({ First: 2, Second: 1, Other: null });
  });

  it('rejects malformed lists and unknown projects', async () => {
    const alpha = await project('alpha');
    await put('/api/projects/order', { projectIds: [] }).expect(400);
    await put('/api/projects/order', { projectIds: ['nope'] }).expect(400);
    await put(`/api/projects/${alpha.id}/chat-order`, { conversationIds: [] }).expect(400);
    await put(`/api/projects/${randomUUID()}/chat-order`, {
      conversationIds: [randomUUID()],
    }).expect(404);
  });
});
