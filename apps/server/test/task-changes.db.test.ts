import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  changedFileSchema,
  runChangesSchema,
  taskChangesSchema,
  taskOverviewSchema,
  type TaskChanges,
} from '@spark-outpost/contracts';
import { getRun } from '../src/persistence/runs.ts';
import { insertWorktree, saveResult } from '../src/persistence/worktrees.ts';
import { backupBeforeEdit, snapshotRun } from '../src/projects/run-changes.ts';
import {
  addWorktree,
  branchName,
  commitWorktree,
  groupBase,
  removeWorktree,
  worktreePath,
} from '../src/projects/worktrees.ts';
import { createFakeProvider } from '../src/providers/fake.ts';
import { startWorker, type Worker } from '../src/workflow/worker.ts';
import { createTestApp, ORIGIN, LOCAL_HEADERS } from './app-support.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

let t: TestDb;
let worker: Worker;
let app: ReturnType<typeof createTestApp>;
let base: string;

const detailSchema = z.object({ tasks: z.array(taskOverviewSchema) });

beforeAll(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'spark-task-changes-')));
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

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

async function send(conversationId: string, content: string): Promise<string> {
  const sent = await post(`/api/conversations/${conversationId}/messages`, {
    id: randomUUID(),
    content,
  }).expect(201);
  const runId = sent.body.run.id as string;
  const run = await eventually(async () => {
    const current = await getRun(t.db, runId);
    return current?.finishedAt ? current : null;
  }, 15_000);
  expect(run.error).toBeNull();
  expect(run.status).toBe('succeeded');
  return runId;
}

async function twoRunTask(): Promise<{ taskId: string; runs: [string, string] }> {
  const conversationId = randomUUID();
  await post('/api/conversations', { id: conversationId }).expect(201);
  const first = await send(conversationId, 'Fix the divider #plan');
  const second = await send(conversationId, 'And one more thing');
  const detail = detailSchema.parse(
    (await get(`/api/conversations/${conversationId}`).expect(200)).body,
  );
  return { taskId: detail.tasks[0]!.id, runs: [first, second] };
}

async function changes(taskId: string): Promise<TaskChanges> {
  return taskChangesSchema.parse((await get(`/api/tasks/${taskId}/changes`).expect(200)).body);
}

describe('task changes', { timeout: 60_000 }, () => {
  it('splits git changes by run and counts lines', async () => {
    const root = join(base, 'repo');
    await mkdir(root);
    execFileSync('git', ['init', '-q', root]);
    await writeFile(join(root, 'a.ts'), 'one\ntwo\n');
    execFileSync('git', ['-C', root, 'add', '.']);
    execFileSync('git', [
      '-C',
      root,
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@t',
      'commit',
      '-qm',
      'a',
    ]);
    const { taskId, runs } = await twoRunTask();

    await snapshotRun(t.db, runs[0], root);
    await writeFile(join(root, 'a.ts'), 'one\n2\nthree\n');
    await snapshotRun(t.db, runs[1], root);
    await writeFile(join(root, 'b.bin'), Buffer.from([0, 1, 2]));
    await writeFile(join(root, 'c.md'), '# C\n');

    const result = await changes(taskId);
    expect(result.runs.map((run) => run.runId)).toEqual(runs);
    expect(result.runs[0]!.files).toEqual([
      {
        path: 'a.ts',
        change: 'modified',
        added: 2,
        removed: 1,
        oldText: 'one\ntwo\n',
        newText: 'one\n2\nthree\n',
        shown: 'text',
      },
    ]);
    expect(result.runs[1]!.files).toEqual([
      expect.objectContaining({ path: 'b.bin', change: 'added', shown: 'binary', oldText: null }),
      expect.objectContaining({ path: 'c.md', change: 'added', added: 1, removed: 0 }),
    ]);
  });

  it('keeps true counts for truncated files, pairs renames, and serves one full file', async () => {
    const root = join(base, 'large');
    await mkdir(root);
    execFileSync('git', ['init', '-q', root]);
    const moved = Array.from({ length: 30 }, (_, index) => `export const v${index} = ${index};`);
    await writeFile(join(root, 'old-name.ts'), `${moved.join('\n')}\n`);
    await writeFile(join(root, 'big.txt'), 'seed\n');
    execFileSync('git', ['-C', root, 'add', '.']);
    execFileSync('git', [
      '-C',
      root,
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@t',
      'commit',
      '-qm',
      'a',
    ]);
    const { taskId, runs } = await twoRunTask();

    await snapshotRun(t.db, runs[0], root);
    const big = Array.from({ length: 30_000 }, (_, index) => `row ${index} of the big file`);
    await writeFile(join(root, 'big.txt'), `seed\n${big.join('\n')}\n`);
    await rm(join(root, 'old-name.ts'));
    moved[4] = 'export const four = 4;';
    await writeFile(join(root, 'new-name.ts'), `${moved.join('\n')}\n`);

    const files = (await changes(taskId)).runs[0]!.files;
    expect(files.map((file) => file.path).sort()).toEqual(['big.txt', 'new-name.ts']);
    expect(files.find((file) => file.path === 'big.txt')).toMatchObject({
      shown: 'too-large',
      truncated: true,
      added: 30_000,
      removed: 0,
      newText: null,
    });
    expect(files.find((file) => file.path === 'new-name.ts')).toMatchObject({
      oldPath: 'old-name.ts',
      change: 'modified',
      added: 1,
      removed: 1,
    });

    const full = changedFileSchema.parse(
      (
        await get(`/api/tasks/${taskId}/changes/file`)
          .query({ runId: runs[0], path: 'big.txt' })
          .expect(200)
      ).body,
    );
    expect(full).toMatchObject({ shown: 'text', added: 30_000, removed: 0 });
    expect(full.newText?.endsWith('row 29999 of the big file\n')).toBe(true);
    await get(`/api/tasks/${taskId}/changes/file`)
      .query({ runId: runs[0], path: 'missing.txt' })
      .expect(404);
    await get(`/api/tasks/${taskId}/changes/file`).query({ path: 'big.txt' }).expect(400);
  });

  it('uses the next run backup as the end of a file-copy run', async () => {
    const root = join(base, 'plain');
    await mkdir(root);
    const target = join(root, 'notes.txt');
    await writeFile(target, 'first\n');
    const { taskId, runs } = await twoRunTask();

    const firstSnapshot = await snapshotRun(t.db, runs[0], root);
    await backupBeforeEdit(t.db, runs[0], firstSnapshot, [target]);
    await writeFile(target, 'second\n');
    const secondSnapshot = await snapshotRun(t.db, runs[1], root);
    await backupBeforeEdit(t.db, runs[1], secondSnapshot, [target]);
    await writeFile(target, 'third\n');

    const result = await changes(taskId);
    expect(result.runs.map((run) => run.files.map((file) => [file.oldText, file.newText]))).toEqual(
      [[['first\n', 'second\n']], [['second\n', 'third\n']]],
    );
  });

  it("serves a lane's changes from its refs after the worktree is removed", async () => {
    const root = join(base, 'lanes');
    await mkdir(root);
    execFileSync('git', ['init', '-q', root]);
    await writeFile(join(root, 'a.ts'), 'one\n');
    execFileSync('git', ['-C', root, 'add', '.']);
    execFileSync('git', [
      '-C',
      root,
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@t',
      'commit',
      '-qm',
      'a',
    ]);
    const { taskId, runs } = await twoRunTask();
    await worker.stop();
    const [lane, fix] = runs;
    const copy = worktreePath(root, lane);
    const branch = branchName(taskId, 'Bolt');
    const baseCommit = await groupBase(root, 'g1');
    await addWorktree(root, copy, branch, baseCommit);
    await insertWorktree(t.db, {
      runId: lane,
      orchestrationRunId: lane,
      repoRoot: root,
      path: copy,
      branch,
      baseCommit,
    });
    await t.db.query(`UPDATE runs SET route = $2 WHERE id = $1`, [
      fix,
      JSON.stringify({ name: 'Bolt', worktreeRun: lane }),
    ]);
    await snapshotRun(t.db, lane, copy);
    await writeFile(join(copy, 'a.ts'), 'one\ntwo\n');
    await snapshotRun(t.db, fix, copy);
    await writeFile(join(copy, 'fixed.txt'), 'fixed\n');
    await saveResult(t.db, lane, await commitWorktree(root, copy, branch, baseCommit, lane));
    await removeWorktree(root, copy, branch);

    const own = runChangesSchema.parse((await get(`/api/runs/${fix}/changes`).expect(200)).body);
    expect(own).toMatchObject({
      revertible: false,
      files: [{ path: 'fixed.txt', change: 'added' }],
    });
    const result = await changes(taskId);
    const fixFiles = result.runs.find((run) => run.runId === fix)?.files;
    expect(fixFiles?.map((file) => [file.path, file.newText])).toEqual([['fixed.txt', 'fixed\n']]);
    const laneFiles = result.runs.find((run) => run.runId === lane)?.files;
    expect(laneFiles?.map((file) => file.path).sort()).toEqual(['a.ts', 'fixed.txt']);
  });

  it('returns nothing for runs without changes and 404 for unknown tasks', async () => {
    const { taskId } = await twoRunTask();
    expect(await changes(taskId)).toEqual({ runs: [], core: null });
    await get(`/api/tasks/${randomUUID()}/changes`).expect(404);
  });
});
