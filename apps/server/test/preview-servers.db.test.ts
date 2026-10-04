import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { API_TOKEN_ENV } from '@spark-outpost/contracts';
import { insertChatWorktree } from '../src/persistence/chat-worktrees.ts';
import {
  previewRowAt,
  stopAllPreviewRows,
  type PreviewRow,
} from '../src/persistence/preview-servers.ts';
import {
  chatPreviewPlace,
  PreviewNotSetUpError,
  settledPreview,
  startPreview,
} from '../src/preview/requests.ts';
import { PreviewServers } from '../src/preview/servers.ts';
import { saveProjectPreview } from '../src/projects/projects.ts';
import { linkedConversation } from './approval-support.ts';
import { FAST_PREVIEW, fakePreviewRuntime, type FakePreviewRuntime } from './preview-support.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

const CONFIG = { command: 'pnpm dev', url: 'http://localhost:5173/', folder: null, readyUrl: null };
const USER = { by: 'user', runId: null, conversationId: null } as const;

let t: TestDb;
let base: string;
let root: string;
let fake: FakePreviewRuntime;
let previews: PreviewServers;
let chat: { conversationId: string; projectId: string };

beforeEach(async () => {
  t = await createTestDb();
  base = realpathSync(mkdtempSync(path.join(tmpdir(), 'spark-preview-')));
  root = path.join(base, 'site');
  mkdirSync(root);
  fake = fakePreviewRuntime({
    PATH: '/usr/bin',
    [API_TOKEN_ENV]: 'launch-token-launch-token-launch-token',
    DATABASE_URL: 'postgres://spark:pw@127.0.0.1/spark',
    OPENAI_API_KEY: 'sk-secret',
  });
  previews = new PreviewServers(t.db, t.workspaceId, fake.runtime, FAST_PREVIEW);
  chat = await linkedConversation(t, root);
  await saveProjectPreview(t.db, t.workspaceId, chat.projectId, CONFIG);
});

afterEach(async () => {
  await previews.stopAll('test');
  rmSync(base, { recursive: true, force: true });
  await t.cleanup();
});

async function place() {
  return (await chatPreviewPlace(t.db, t.workspaceId, chat.conversationId))!;
}

async function start(ask: Parameters<typeof startPreview>[2] = USER): Promise<PreviewRow> {
  const row = await startPreview(t.db, await place(), ask);
  await previews.sync();
  return row;
}

async function row(): Promise<PreviewRow> {
  return (await previewRowAt(t.db, chat.projectId, (await place()).folder))!;
}

async function status(wanted: PreviewRow['status']): Promise<PreviewRow> {
  return eventually(async () => {
    const current = await row();
    return current.status === wanted ? current : null;
  }, 5_000);
}

async function events(): Promise<
  { action: string; asked_by: string; detail: Record<string, unknown> }[]
> {
  const { rows } = await t.db.query<{
    action: string;
    asked_by: string;
    detail: Record<string, unknown>;
  }>('SELECT action, asked_by, detail FROM preview_events ORDER BY created_at, id');
  return rows;
}

describe('a Spark-managed preview server', () => {
  it('runs the saved command in the project folder and is ready once the address answers', async () => {
    await start();
    expect(fake.spawned).toHaveLength(1);
    expect(fake.spawned[0]!.options).toMatchObject({ command: 'pnpm dev', cwd: root });
    expect((await row()).status).toBe('starting');

    fake.answering.add('http://localhost:5173/');
    const ready = await status('ready');
    expect(ready).toMatchObject({ url: 'http://localhost:5173/', pid: 4000, askedBy: 'user' });
    expect((await settledPreview(t.db, ready.id))!.status).toBe('ready');
    expect((await events()).map((event) => [event.action, event.asked_by])).toEqual([
      ['start', 'user'],
      ['ready', 'spark'],
    ]);
  });

  it('gives the command no launch token, database address or keys, and its own port', async () => {
    await start();
    expect(fake.spawned[0]!.options.env).toEqual({
      PATH: '/usr/bin',
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      PORT: '5173',
    });
  });

  it('starts one server for two requests at once and for a request while it runs', async () => {
    const target = await place();
    const [first, second] = await Promise.all([
      startPreview(t.db, target, USER),
      startPreview(t.db, target, { by: 'agent', runId: null, conversationId: chat.conversationId }),
    ]);
    await Promise.all([previews.sync(), previews.sync()]);
    expect(first.id).toBe(second.id);
    expect(fake.spawned).toHaveLength(1);
    fake.answering.add('http://localhost:5173/');
    await status('ready');
    await start();
    expect(fake.spawned).toHaveLength(1);
    expect((await events()).filter((event) => event.action === 'start')).toHaveLength(1);
  });

  it('moves to the next free port when the address is taken and reports the real address', async () => {
    fake.busyPorts.add(5173);
    fake.answering.add('http://localhost:5173/');
    await start();
    expect(fake.spawned[0]!.options.env.PORT).toBe('5174');
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect((await row()).status).toBe('starting');

    fake.answering.add('http://localhost:5174/');
    expect((await status('ready')).url).toBe('http://localhost:5174/');
    expect((await events()).at(-1)).toMatchObject({
      action: 'ready',
      detail: { port: 5174, movedFrom: 5173 },
    });
  });

  it('follows the address the dev server prints when it picks its own port', async () => {
    await start();
    fake.spawned[0]!.print('  ➜  Local:   http://localhost:5199/\r\n');
    fake.answering.add('http://localhost:5199/');
    expect((await status('ready')).url).toBe('http://localhost:5199/');
  });

  it('fails with the last lines when the command exits before the page answers', async () => {
    await start();
    fake.spawned[0]!.print('sh: pnpm: command not found\r\n');
    fake.spawned[0]!.exit(127);
    const failed = await status('failed');
    expect(failed.wanted).toBe('stopped');
    expect(failed.detail).toContain('exited with code 127 before the page answered');
    expect(failed.detail).toContain('pnpm: command not found');
    expect(fake.spawned).toHaveLength(1);
    expect((await events()).at(-1)).toMatchObject({ action: 'failed', asked_by: 'spark' });
  });

  it('fails when nothing answers in time, and a new request starts it again', async () => {
    await start();
    const failed = await status('failed');
    expect(failed.detail).toContain('Nothing answered at http://localhost:5173/');
    expect(fake.spawned[0]!.killed).toBe(true);

    fake.answering.add('http://localhost:5173/');
    await start();
    expect((await status('ready')).pid).toBe(4001);
  });

  it('restarts a server that crashes, with a pause, and gives up after the last try', async () => {
    fake.answering.add('http://localhost:5173/');
    await start();
    await status('ready');
    fake.answering.clear();
    fake.spawned[0]!.exit(1);
    await eventually(async () => fake.spawned.length === 2);
    expect(await row()).toMatchObject({ status: 'starting', restarts: 1 });

    fake.answering.add('http://localhost:5173/');
    expect(await status('ready')).toMatchObject({ pid: 4001, restarts: 1 });

    fake.answering.clear();
    fake.spawned[1]!.exit(1);
    await eventually(async () => fake.spawned.length === 3);
    fake.spawned[2]!.exit(1);
    const failed = await status('failed');
    expect(failed.detail).toContain('Spark restarted it 2 times');
    expect((await events()).map((event) => event.action)).toEqual([
      'start',
      'ready',
      'crashed',
      'restart',
      'ready',
      'crashed',
      'restart',
      'failed',
    ]);
  });

  it('stops when asked, and records who asked', async () => {
    fake.answering.add('http://localhost:5173/');
    const started = await start();
    await status('ready');
    const { askPreviewStop } = await import('../src/persistence/preview-servers.ts');
    await askPreviewStop(
      t.db,
      started.id,
      { by: 'agent', runId: null, conversationId: chat.conversationId },
      'agent',
    );
    await previews.sync();
    expect(await row()).toMatchObject({
      status: 'stopped',
      wanted: 'stopped',
      url: null,
      pid: null,
    });
    expect(fake.spawned[0]!.killed).toBe(true);
    fake.spawned[0]!.exit(null);
    await previews.sync();
    expect(fake.spawned).toHaveLength(1);
    expect((await events()).at(-1)).toMatchObject({
      action: 'stop',
      asked_by: 'agent',
      detail: { reason: 'agent' },
    });
  });

  it("runs in the chat's worktree, one server per copy, and stops when the copy is removed", async () => {
    const copy = path.join(base, 'copies', 'one');
    mkdirSync(copy, { recursive: true });
    await insertChatWorktree(t.db, {
      id: randomUUID(),
      conversationId: chat.conversationId,
      projectId: chat.projectId,
      repoRoot: root,
      path: copy,
      branch: 'spark/preview-1a2b3c4d',
      baseBranch: 'main',
      baseCommit: 'abc',
      landedCommit: null,
      inPlace: false,
      ownsBranch: true,
    });
    fake.answering.add('http://localhost:5173/');
    await start();
    expect(fake.spawned[0]!.options.cwd).toBe(copy);
    await status('ready');

    fake.missingFolders.add(copy);
    const stopped = await status('stopped');
    expect(stopped.folder).toBe(copy);
    expect(fake.spawned[0]!.killed).toBe(true);
    expect((await events()).at(-1)).toMatchObject({
      action: 'stop',
      asked_by: 'spark',
      detail: { reason: 'folder_removed' },
    });
  });

  it('uses the working folder inside the project and refuses one that is missing', async () => {
    await saveProjectPreview(t.db, t.workspaceId, chat.projectId, {
      ...CONFIG,
      folder: 'apps/web',
    });
    fake.missingFolders.add(path.join(root, 'apps/web'));
    await start();
    expect((await status('failed')).detail).toContain('apps/web does not exist');
    expect(fake.spawned).toHaveLength(0);

    fake.missingFolders.clear();
    await start();
    expect(fake.spawned[0]!.options.cwd).toBe(path.join(root, 'apps/web'));
  });

  it('says how to set it up when the project has no preview', async () => {
    await saveProjectPreview(t.db, t.workspaceId, chat.projectId, null);
    await expect(startPreview(t.db, await place(), USER)).rejects.toBeInstanceOf(
      PreviewNotSetUpError,
    );
    expect(fake.spawned).toHaveLength(0);
    expect(await events()).toEqual([]);
  });

  it('stops every server on quit and marks leftovers stopped at the next start', async () => {
    fake.answering.add('http://localhost:5173/');
    await start();
    await status('ready');
    await previews.stopAll('shutdown');
    expect(fake.spawned[0]!.killed).toBe(true);
    expect(previews.runningCount).toBe(0);
    expect(await row()).toMatchObject({ status: 'stopped', wanted: 'stopped' });
    expect((await events()).at(-1)).toMatchObject({
      action: 'stop',
      detail: { reason: 'shutdown' },
    });

    await t.db.query(`UPDATE preview_servers SET status = 'ready', wanted = 'running', pid = 99`);
    await stopAllPreviewRows(t.db, t.workspaceId);
    expect(await row()).toMatchObject({ status: 'stopped', wanted: 'stopped', pid: null });
  });

  it('replays its output to a terminal view and keeps running when the view closes', async () => {
    fake.answering.add('http://localhost:5173/');
    const started = await start();
    fake.spawned[0]!.print('ready in 120 ms\r\n');
    await status('ready');
    const seen: string[] = [];
    let ended = false;
    const view = previews.view(
      started.id,
      { output: (data) => seen.push(data), ended: () => (ended = true) },
      { cols: 90, rows: 20 },
    )!;
    fake.spawned[0]!.print('page reload\r\n');
    view.input('r');
    expect(seen).toEqual(['ready in 120 ms\r\n', 'page reload\r\n']);
    expect(fake.spawned[0]!.written).toEqual(['r']);
    expect(fake.spawned[0]!.size).toEqual({ cols: 90, rows: 20 });

    view.detach();
    fake.spawned[0]!.print('later\r\n');
    expect(seen).toHaveLength(2);
    expect(fake.spawned[0]!.killed).toBe(false);
    expect(ended).toBe(false);
    await eventually(async () => ((await row()).logTail.includes('later') ? true : null));
    expect(
      previews.view(
        randomUUID(),
        { output: () => undefined, ended: () => undefined },
        { cols: 80, rows: 24 },
      ),
    ).toBeNull();
  });
});
