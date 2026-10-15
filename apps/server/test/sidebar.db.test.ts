import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ConversationSummary, Project } from '@spark-outpost/contracts';
import { sendUserMessage } from '../src/persistence/conversations.ts';
import { createTestApp, ORIGIN, LOCAL_HEADERS } from './app-support.ts';
import { createTestDb, startChat, type TestDb } from './support.ts';

let t: TestDb;
let app: ReturnType<typeof createTestApp>;
let base: string;

beforeAll(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'spark-sidebar-')));
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

const api = {
  list: async (q?: string) => {
    const path =
      q === undefined ? '/api/conversations' : `/api/conversations?q=${encodeURIComponent(q)}`;
    return (await request(app).get(path).set(LOCAL_HEADERS).expect(200))
      .body as ConversationSummary[];
  },
  patch: (id: string, body: object) =>
    request(app).patch(`/api/conversations/${id}`).set(LOCAL_HEADERS).send(body),
  seen: (id: string) =>
    request(app).post(`/api/conversations/${id}/seen`).set(LOCAL_HEADERS).send({}),
  remove: (id: string) =>
    request(app).delete(`/api/conversations/${id}`).set(LOCAL_HEADERS).send({}),
  settings: (id: string, body: object) =>
    request(app).patch(`/api/conversations/${id}/settings`).set(LOCAL_HEADERS).send(body),
};

async function chat(content: string): Promise<{ id: string; runId: string }> {
  const { conversationId, runId } = await startChat(t, content);
  return { id: conversationId, runId };
}

async function finishRun(runId: string, status: 'succeeded' | 'failed', error: string | null) {
  await t.db.query(
    `UPDATE runs SET status = $2, error = $3, started_at = now(), finished_at = now() WHERE id = $1`,
    [runId, status, error],
  );
}

async function project(name: string): Promise<Project> {
  const folder = join(base, `${name}-${randomUUID()}`);
  await mkdir(folder);
  const response = await request(app)
    .post('/api/projects')
    .set(LOCAL_HEADERS)
    .set('Origin', ORIGIN)
    .send({ rootPath: folder });
  return response.body as Project;
}

const titles = (list: ConversationSummary[]) => list.map((entry) => entry.title);

describe('search', () => {
  it('matches titles and message text, case-insensitively, and treats wildcards literally', async () => {
    await chat('Fix the date divider');
    const second = await chat('Tray icon states');
    await sendUserMessage(
      t.db,
      second.id,
      { id: randomUUID(), content: 'Also check 100% zoom' },
      {
        provider: 'fake',
      },
    );
    await chat('Worktree cleanup');

    expect(titles(await api.list('DIVIDER'))).toEqual(['Fix the date divider']);
    expect(titles(await api.list('zoom'))).toEqual(['Tray icon states']);
    expect(titles(await api.list('100%'))).toEqual(['Tray icon states']);
    expect(await api.list('%')).toHaveLength(1);
    expect(await api.list('_')).toHaveLength(0);
    expect(await api.list('   ')).toHaveLength(3);
    expect(await api.list('nothing like this')).toEqual([]);
    await request(app)
      .get(`/api/conversations?q=${'x'.repeat(201)}`)
      .set(LOCAL_HEADERS)
      .expect(400);
  });
});

describe('archive, rename and pin', () => {
  it('archives and restores without reordering, and a new message restores it', async () => {
    const older = await chat('Older chat');
    const newer = await chat('Newer chat');

    const archived = (await api.patch(newer.id, { archived: true }).expect(200))
      .body as ConversationSummary;
    expect(archived.archivedAt).not.toBeNull();
    const list = await api.list();
    expect(list.map((entry) => [entry.title, entry.archivedAt !== null])).toEqual([
      ['Newer chat', true],
      ['Older chat', false],
    ]);

    await api.patch(newer.id, { archived: false }).expect(200);
    expect((await api.list()).every((entry) => entry.archivedAt === null)).toBe(true);

    await api.patch(older.id, { archived: true }).expect(200);
    await sendUserMessage(
      t.db,
      older.id,
      { id: randomUUID(), content: 'Back again' },
      {
        provider: 'fake',
      },
    );
    expect((await api.list())[0]).toMatchObject({ title: 'Older chat', archivedAt: null });
  });

  it('renames with a trimmed title and rejects empty or oversized titles', async () => {
    const { id } = await chat('Original');
    const renamed = (await api.patch(id, { title: '  Release notes  ' }).expect(200))
      .body as ConversationSummary;
    expect(renamed.title).toBe('Release notes');
    await api.patch(id, { title: '   ' }).expect(400);
    await api.patch(id, { title: 'x'.repeat(101) }).expect(400);
    await api.patch(id, {}).expect(400);
    await api.patch(randomUUID(), { title: 'Ghost' }).expect(404);
    await sendUserMessage(t.db, id, { id: randomUUID(), content: 'More' }, { provider: 'fake' });
    expect(titles(await api.list())).toEqual(['Release notes']);
  });

  it('lists pinned chats first, most recently pinned on top, and keeps the pin time', async () => {
    const first = await chat('First');
    const second = await chat('Second');
    await chat('Third');

    const pinned = (await api.patch(first.id, { pinned: true }).expect(200))
      .body as ConversationSummary;
    await api.patch(first.id, { pinned: true }).expect(200);
    const again = (await api.list()).find((entry) => entry.id === first.id);
    expect(again?.pinnedAt).toBe(pinned.pinnedAt);
    await api.patch(second.id, { pinned: true }).expect(200);
    expect(titles(await api.list())).toEqual(['Second', 'First', 'Third']);

    await api.patch(second.id, { pinned: false }).expect(200);
    expect(titles(await api.list())).toEqual(['First', 'Third', 'Second']);
  });
});

describe('delete', () => {
  it('removes the chat with its messages and runs, stopping a reply that is still queued', async () => {
    const { id } = await chat('Short-lived');
    await api.remove(id).expect(204);
    expect(await api.list()).toEqual([]);
    const left = await t.db.query(
      `SELECT (SELECT count(*) FROM messages)::int AS messages, (SELECT count(*) FROM runs)::int AS runs`,
    );
    expect(left.rows[0]).toEqual({ messages: 0, runs: 0 });
    await api.remove(id).expect(404);
  });
});

describe('moving between projects', () => {
  it('makes the drop target primary, keeps other repos, and clears them all', async () => {
    const [web, lib, docs] = await Promise.all([project('web'), project('lib'), project('docs')]);
    const { id } = await chat('Moving chat');
    await api.settings(id, { projectIds: [web.id, lib.id] }).expect(200);

    await api.settings(id, { projectIds: [docs.id, web.id, lib.id] }).expect(200);
    expect((await api.list())[0]?.projectIds).toEqual([docs.id, web.id, lib.id]);

    await api.settings(id, { projectIds: [lib.id, docs.id, web.id] }).expect(200);
    expect((await api.list())[0]?.projectIds).toEqual([lib.id, docs.id, web.id]);

    await api.settings(id, { projectIds: [] }).expect(200);
    expect((await api.list())[0]?.projectIds).toEqual([]);
  });
});

describe('unread and attention', () => {
  it('marks a finished reply unread until the chat is opened', async () => {
    const { id, runId } = await chat('Review this');
    expect((await api.list())[0]).toMatchObject({ unread: false, needsInput: false });

    await finishRun(runId, 'succeeded', null);
    expect((await api.list())[0]?.unread).toBe(true);

    await api.seen(id).expect(204);
    expect((await api.list())[0]?.unread).toBe(false);
    await api.seen(randomUUID()).expect(404);
  });

  it('reports the latest failure reason and the running step', async () => {
    const failed = await chat('Will fail');
    await finishRun(failed.runId, 'failed', 'The provider hit its rate limit.');
    const running = await chat('Still going');
    await t.db.query(`UPDATE runs SET status = 'running', started_at = now() WHERE id = $1`, [
      running.runId,
    ]);
    await t.db.query(
      `INSERT INTO run_events (run_id, seq, type, payload) VALUES
        ($1, 1, 'STEP_STARTED', '{"stepName":"Reading files"}'),
        ($1, 2, 'STEP_STARTED', '{"stepName":"Writing a reply"}')`,
      [running.runId],
    );

    const list = await api.list();
    expect(list.find((entry) => entry.id === failed.id)).toMatchObject({
      unread: false,
      latestRun: { status: 'failed', error: 'The provider hit its rate limit.', step: null },
    });
    expect(list.find((entry) => entry.id === running.id)?.latestRun).toMatchObject({
      status: 'running',
      step: 'Writing a reply',
    });
  });
});
