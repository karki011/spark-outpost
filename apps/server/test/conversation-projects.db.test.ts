import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CONVERSATION_PROJECTS_MAX,
  type ConversationDetail,
  type ConversationSummary,
  type Project,
} from '@spark-outpost/contracts';
import { sendUserMessage } from '../src/persistence/conversations.ts';
import { loadRunInput } from '../src/workflow/run-input.ts';
import { createTestApp, ORIGIN, LOCAL_HEADERS } from './app-support.ts';
import { connectCliProvider, createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let app: ReturnType<typeof createTestApp>;
let base: string;
const folders: Record<'app' | 'lib' | 'docs', string> = { app: '', lib: '', docs: '' };

beforeAll(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'spark-links-')));
  for (const name of ['app', 'lib', 'docs'] as const) {
    folders[name] = join(base, name);
    await mkdir(folders[name]);
  }
  execFileSync('git', ['init', '-q', '-b', 'trunk', folders.lib]);
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

beforeEach(async () => {
  t = await createTestDb();
  app = createTestApp(t);
  await connectCliProvider(t, 'claude');
});

afterEach(async () => {
  await t.cleanup();
});

const get = (path: string) => request(app).get(path).set(LOCAL_HEADERS);

async function project(folder: string): Promise<Project> {
  const response = await request(app)
    .post('/api/projects')
    .set(LOCAL_HEADERS)
    .set('Origin', ORIGIN)
    .send({ rootPath: folder });
  return response.body as Project;
}

const patch = (conversationId: string, body: unknown) =>
  request(app)
    .patch(`/api/conversations/${conversationId}/settings`)
    .set(LOCAL_HEADERS)
    .send(body as object);

async function linkedIds(conversationId: string): Promise<string[]> {
  const detail = (await get(`/api/conversations/${conversationId}`).expect(200))
    .body as ConversationDetail;
  return detail.conversation.projectIds;
}

async function runRoots(conversationId: string): Promise<string[]> {
  const sent = await sendUserMessage(
    t.db,
    conversationId,
    { id: randomUUID(), content: 'Look' },
    { provider: 'fake' },
  );
  return (await loadRunInput(t.db, sent.run.id)).projectRoots;
}

describe('conversation repos', () => {
  it('links repos in order, reorders, unlinks, and feeds the run its roots', async () => {
    const [appRepo, libRepo, docsRepo] = await Promise.all([
      project(folders.app),
      project(folders.lib),
      project(folders.docs),
    ]);
    const id = randomUUID();
    await patch(id, { projectIds: [appRepo.id, libRepo.id] }).expect(200);
    expect(await linkedIds(id)).toEqual([appRepo.id, libRepo.id]);
    expect(await runRoots(id)).toEqual([folders.app, folders.lib]);

    await patch(id, { projectIds: [libRepo.id, docsRepo.id, appRepo.id] }).expect(200);
    expect(await linkedIds(id)).toEqual([libRepo.id, docsRepo.id, appRepo.id]);

    await patch(id, { projectIds: [libRepo.id, appRepo.id] }).expect(200);
    expect(await linkedIds(id)).toEqual([libRepo.id, appRepo.id]);
    expect(await runRoots(id)).toEqual([folders.lib, folders.app]);

    const list = (await get('/api/conversations').expect(200)).body as ConversationSummary[];
    expect(list.find((entry) => entry.id === id)?.projectIds).toEqual([libRepo.id, appRepo.id]);

    await patch(id, { projectIds: [] }).expect(200);
    expect(await linkedIds(id)).toEqual([]);
    expect(await runRoots(id)).toEqual([]);
  });

  it('drops a deleted project from every chat', async () => {
    const [appRepo, libRepo] = await Promise.all([project(folders.app), project(folders.lib)]);
    const id = randomUUID();
    await patch(id, { projectIds: [appRepo.id, libRepo.id] }).expect(200);
    await request(app)
      .delete(`/api/projects/${appRepo.id}`)
      .set(LOCAL_HEADERS)
      .send({})
      .expect(200);
    expect(await linkedIds(id)).toEqual([libRepo.id]);
  });

  it('rejects unknown, duplicate, too many and malformed ids without changing the links', async () => {
    const appRepo = await project(folders.app);
    const id = randomUUID();
    await patch(id, { projectIds: [appRepo.id], effort: 'high' }).expect(200);
    const unknown = await patch(id, { projectIds: [appRepo.id, randomUUID()] }).expect(404);
    expect(unknown.body.error).toBe('Project not found.');
    await patch(id, { projectIds: [appRepo.id, appRepo.id] }).expect(400);
    const tooMany = Array.from({ length: CONVERSATION_PROJECTS_MAX + 1 }, () => randomUUID());
    await patch(id, { projectIds: tooMany }).expect(400);
    await patch(id, { projectIds: ['nope'] }).expect(400);
    await patch(id, { projectId: appRepo.id }).expect(400);
    expect(await linkedIds(id)).toEqual([appRepo.id]);
  });
});

describe('recent repos', () => {
  it('stamps each project with when it was last linked or used, keeping the list order', async () => {
    const appRepo = await project(folders.app);
    const docsRepo = await project(folders.docs);
    const libRepo = await project(folders.lib);
    const id = randomUUID();
    await patch(id, { projectIds: [appRepo.id] }).expect(200);
    await runRoots(id);
    const list = (await get('/api/projects').expect(200)).body as Project[];
    expect(list.map((entry) => entry.name)).toEqual(['app', 'docs', 'lib']);
    const used = new Map(list.map((entry) => [entry.id, entry.lastUsedAt ?? '']));
    expect(used.get(docsRepo.id)).toBe(docsRepo.createdAt);
    expect(used.get(libRepo.id)).toBe(libRepo.createdAt);
    expect(used.get(appRepo.id)! > libRepo.createdAt).toBe(true);
  });
});

describe('new chats', () => {
  it('start with no repos, whatever the last chat used', async () => {
    const appRepo = await project(folders.app);
    await patch(randomUUID(), { projectIds: [appRepo.id] }).expect(200);
    const fresh = randomUUID();
    await sendUserMessage(
      t.db,
      fresh,
      { id: randomUUID(), content: 'Hi' },
      { provider: 'fake' },
      t.workspaceId,
    );
    expect(await linkedIds(fresh)).toEqual([]);
    await get('/api/default-projects').expect(404);
  });
});

describe('project git info', () => {
  it('reports the current branch, or null outside git', async () => {
    const [appRepo, libRepo] = await Promise.all([project(folders.app), project(folders.lib)]);
    expect((await get(`/api/projects/${libRepo.id}/git`).expect(200)).body).toEqual({
      branch: 'trunk',
      repository: true,
      problem: null,
    });
    expect((await get(`/api/projects/${appRepo.id}/git`).expect(200)).body).toEqual({
      branch: null,
      repository: false,
      problem: null,
    });
    await get(`/api/projects/${randomUUID()}/git`).expect(404);
  });
});
