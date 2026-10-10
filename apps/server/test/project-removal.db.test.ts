import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm, stat } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  PROJECT_NAME_MAX,
  type ConversationDetail,
  type Project,
  type RemovedProject,
} from '@spark-outpost/contracts';
import { createTestApp, ORIGIN, LOCAL_HEADERS } from './app-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let app: ReturnType<typeof createTestApp>;
let base: string;
const folders: Record<'app' | 'lib', string> = { app: '', lib: '' };

beforeAll(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'spark-removal-')));
  for (const name of ['app', 'lib'] as const) {
    folders[name] = join(base, name);
    await mkdir(folders[name]);
  }
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

const get = (path: string) => request(app).get(path).set(LOCAL_HEADERS);
const send = (method: 'post' | 'patch' | 'delete', path: string, body: object = {}) =>
  request(app)[method](path).set(LOCAL_HEADERS).set('Origin', ORIGIN).send(body);

async function project(folder: string): Promise<Project> {
  return (await send('post', '/api/projects', { rootPath: folder }).expect(201)).body as Project;
}

async function link(conversationId: string, projectIds: string[]) {
  await send('patch', `/api/conversations/${conversationId}/settings`, { projectIds }).expect(200);
}

async function linkedIds(conversationId: string): Promise<string[]> {
  const detail = (await get(`/api/conversations/${conversationId}`).expect(200))
    .body as ConversationDetail;
  return detail.conversation.projectIds;
}

async function remove(id: string): Promise<RemovedProject> {
  return (await send('delete', `/api/projects/${id}`).expect(200)).body as RemovedProject;
}

describe('renaming a project', () => {
  it('sets a trimmed display name and keeps the allowlist', async () => {
    const appRepo = await project(folders.app);
    await send('patch', `/api/projects/${appRepo.id}`, { commandAllowlist: ['pnpm test'] }).expect(
      200,
    );
    const renamed = await send('patch', `/api/projects/${appRepo.id}`, { name: '  Main app  ' });
    expect(renamed.status).toBe(200);
    expect(renamed.body).toEqual({
      ...appRepo,
      name: 'Main app',
      commandAllowlist: ['pnpm test'],
    });
    expect((await get('/api/projects').expect(200)).body).toMatchObject([renamed.body]);
  });

  it('sets, clears and validates the check commands', async () => {
    const appRepo = await project(folders.app);
    const path = `/api/projects/${appRepo.id}`;
    const set = await send('patch', path, { checkCommands: ['npm test', ' pnpm lint '] });
    expect(set.status).toBe(200);
    expect(set.body.checkCommands).toEqual(['npm test', 'pnpm lint']);
    const off = await send('patch', path, { checkCommands: [] }).expect(200);
    expect(off.body.checkCommands).toEqual([]);
    const renamed = await send('patch', path, { name: 'App' }).expect(200);
    expect(renamed.body.checkCommands).toEqual([]);
    const detect = await send('patch', path, { checkCommands: null }).expect(200);
    expect(detect.body.checkCommands).toBeNull();
    await send('patch', path, { checkCommands: ['a', 'b', 'c', 'd', 'e', 'f'] }).expect(400);
    await send('patch', path, { checkCommands: ['   '] }).expect(400);
  });

  it('saves the Builder settings and leaves the rest alone', async () => {
    const appRepo = await project(folders.app);
    expect(appRepo).toMatchObject({ parallelPieces: true, pieceSlots: 3 });
    expect(appRepo).not.toHaveProperty('stableCheckout');
    const path = `/api/projects/${appRepo.id}`;
    const one = await send('patch', path, { pieceSlots: 1 }).expect(200);
    expect(one.body).toMatchObject({ parallelPieces: true, pieceSlots: 1, workPlace: 'checkout' });
    const place = await send('patch', path, { workPlace: 'worktree' }).expect(200);
    expect(place.body).toMatchObject({
      parallelPieces: true,
      pieceSlots: 1,
      workPlace: 'worktree',
    });
    const { rows } = await t.db.query(
      'SELECT parallel_pieces, piece_slots, work_place FROM projects WHERE id = $1',
      [appRepo.id],
    );
    expect(rows[0]).toEqual({ parallel_pieces: true, piece_slots: 1, work_place: 'worktree' });
    await send('patch', path, { pieceSlots: 0 }).expect(400);
    await send('patch', path, { pieceSlots: 4 }).expect(400);
    await send('patch', path, { pieceSlots: 1.5 }).expect(400);
    await send('patch', path, { parallelPieces: 'yes' }).expect(400);
    await send('patch', path, { workPlace: 'elsewhere' }).expect(400);
    await send('patch', path, { stableCheckout: true }).expect(400);
  });

  it('shares where Spark works with the chat place picker', async () => {
    const appRepo = await project(folders.app);
    const chat = randomUUID();
    await link(chat, [appRepo.id]);
    await send('patch', `/api/projects/${appRepo.id}`, { workPlace: 'worktree' }).expect(200);
    const workspace = await get(`/api/conversations/${chat}/workspace`).expect(200);
    expect(workspace.body).toMatchObject({ place: 'worktree' });

    const other = randomUUID();
    await link(other, [appRepo.id]);
    await request(app)
      .put(`/api/conversations/${other}/workspace`)
      .set(LOCAL_HEADERS)
      .set('Origin', ORIGIN)
      .send({ place: 'checkout' })
      .expect(200);
    const projects = (await get('/api/projects').expect(200)).body as Project[];
    expect(projects.find((candidate) => candidate.id === appRepo.id)?.workPlace).toBe('checkout');
  });

  it('has no build style to set', async () => {
    const appRepo = await project(folders.app);
    const path = `/api/projects/${appRepo.id}`;
    expect(appRepo).not.toHaveProperty('buildStyle');
    await send('patch', path, { buildStyle: 'off' }).expect(400);
  });

  it('rejects blank, long, empty and unknown requests', async () => {
    const appRepo = await project(folders.app);
    const path = `/api/projects/${appRepo.id}`;
    await send('patch', path, { name: '   ' }).expect(400);
    await send('patch', path, { name: 'x'.repeat(PROJECT_NAME_MAX + 1) }).expect(400);
    await send('patch', path, {}).expect(400);
    await send('patch', `/api/projects/${randomUUID()}`, { name: 'Ghost' }).expect(404);
    expect((await get('/api/projects').expect(200)).body).toMatchObject([appRepo]);
  });
});

describe('removing and restoring a project', () => {
  it('unlinks its chats, leaves the folder, and undo puts everything back', async () => {
    const [appRepo, libRepo] = await Promise.all([project(folders.app), project(folders.lib)]);
    await send('patch', `/api/projects/${appRepo.id}`, {
      name: 'Main app',
      commandAllowlist: ['pnpm lint'],
      parallelPieces: false,
      pieceSlots: 1,
      workPlace: 'worktree',
    }).expect(200);
    const [first, second, third] = [randomUUID(), randomUUID(), randomUUID()];
    await link(first, [appRepo.id, libRepo.id]);
    await link(second, [libRepo.id, appRepo.id]);
    await link(third, [appRepo.id]);

    const removed = await remove(appRepo.id);
    expect(removed.project).toMatchObject({ id: appRepo.id, name: 'Main app' });
    expect(removed.links).toHaveLength(3);
    expect(await linkedIds(first)).toEqual([libRepo.id]);
    expect(await linkedIds(third)).toEqual([]);
    expect((await get('/api/projects').expect(200)).body).toMatchObject([libRepo]);
    expect((await stat(folders.app)).isDirectory()).toBe(true);

    await link(third, [libRepo.id]);
    const restored = await send('post', '/api/projects/restore', removed).expect(201);
    expect(restored.body).toEqual({
      ...appRepo,
      name: 'Main app',
      commandAllowlist: ['pnpm lint'],
      parallelPieces: false,
      pieceSlots: 1,
      workPlace: 'worktree',
    });
    expect(await linkedIds(first)).toEqual([appRepo.id, libRepo.id]);
    expect(await linkedIds(second)).toEqual([libRepo.id, appRepo.id]);
    expect(await linkedIds(third)).toEqual([libRepo.id, appRepo.id]);

    const again = await send('post', '/api/projects/restore', removed).expect(201);
    expect(again.body).toEqual(restored.body);
    expect(await linkedIds(first)).toEqual([appRepo.id, libRepo.id]);
  });

  it('relinks to the project when the folder was added again before undo', async () => {
    const appRepo = await project(folders.app);
    const chat = randomUUID();
    await link(chat, [appRepo.id]);
    const removed = await remove(appRepo.id);
    const readded = await project(folders.app);
    expect(readded.id).not.toBe(appRepo.id);
    const restored = await send('post', '/api/projects/restore', removed).expect(201);
    expect(restored.body.id).toBe(readded.id);
    expect(await linkedIds(chat)).toEqual([readded.id]);
  });

  it('ignores unknown chats and refuses missing, home and malformed folders', async () => {
    const appRepo = await project(folders.app);
    const removed = await remove(appRepo.id);
    const ghost = { ...removed, links: [{ conversationId: randomUUID(), position: 0 }] };
    await send('post', '/api/projects/restore', ghost).expect(201);
    const { rows } = await t.db.query('SELECT 1 FROM conversation_projects');
    expect(rows).toHaveLength(0);

    await remove(appRepo.id);
    const snapshot = removed.project;
    const moved = { ...removed, project: { ...snapshot, rootPath: join(base, 'missing') } };
    await send('post', '/api/projects/restore', moved).expect(400);
    const home = { ...removed, project: { ...snapshot, rootPath: homedir() } };
    const refused = await send('post', '/api/projects/restore', home).expect(400);
    expect(refused.body.error).toBe('Choose a project folder, not your whole disk or home folder.');
    await send('post', '/api/projects/restore', { project: snapshot }).expect(400);
    await send('delete', `/api/projects/${randomUUID()}`).expect(404);
    expect((await get('/api/projects').expect(200)).body).toEqual([]);
  });
});
