import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  changeDiffSchema,
  runChangesSchema,
  taskChangesSchema,
  taskOverviewSchema,
} from '@spark-outpost/contracts';
import { getRun } from '../src/persistence/runs.ts';
import { snapshotRun } from '../src/projects/run-changes.ts';
import { createFakeProvider } from '../src/providers/fake.ts';
import { startWorker, type Worker } from '../src/workflow/worker.ts';
import { createTestApp, LOCAL_HEADERS, ORIGIN } from './app-support.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

let t: TestDb;
let worker: Worker;
let app: ReturnType<typeof createTestApp>;
let scratch: string;
let upstream: string;
let clone: string;

const AUTHOR = ['-c', 'user.email=t@t', '-c', 'user.name=t'];
const detailSchema = z.object({ tasks: z.array(taskOverviewSchema) });

function git(root: string, ...args: string[]): string {
  return execFileSync('git', ['-C', root, ...AUTHOR, ...args], { encoding: 'utf8' }).trim();
}

async function write(root: string, relative: string, text: string): Promise<void> {
  const target = join(root, relative);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, text);
}

function commitAll(root: string, message: string): void {
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', message);
}

async function landUpstream(files: number): Promise<void> {
  for (let index = 0; index < files; index += 1) {
    await write(
      upstream,
      `tools/design-system-mcp/file-${index}.ts`,
      `export const n = ${index};\n`,
    );
  }
  await rm(join(upstream, '.archived'), { recursive: true, force: true });
  commitAll(upstream, 'newer main');
}

const post = (path: string, body: object) =>
  request(app).post(path).set(LOCAL_HEADERS).set('Origin', ORIGIN).send(body);
const get = (path: string) => request(app).get(path).set(LOCAL_HEADERS);

async function finishedRun(): Promise<{ runId: string; taskId: string }> {
  const conversationId = randomUUID();
  await post('/api/conversations', { id: conversationId }).expect(201);
  const sent = await post(`/api/conversations/${conversationId}/messages`, {
    id: randomUUID(),
    content: 'Tidy the app #plan',
  }).expect(201);
  const runId = sent.body.run.id as string;
  await eventually(async () => ((await getRun(t.db, runId))?.finishedAt ? true : null), 15_000);
  const detail = detailSchema.parse(
    (await get(`/api/conversations/${conversationId}`).expect(200)).body,
  );
  return { runId, taskId: detail.tasks[0]!.id };
}

async function runFiles(runId: string): Promise<string[]> {
  const body = runChangesSchema.parse((await get(`/api/runs/${runId}/changes`).expect(200)).body);
  return body.files.map((file) => `${file.change} ${file.path}`).sort();
}

beforeEach(async () => {
  t = await createTestDb();
  const provider = createFakeProvider({ stepMs: 0, wordMs: 0 });
  worker = startWorker({
    db: t.db,
    providers: new Map([[provider.name, provider]]),
    leaseSeconds: 30,
    pollMs: 20,
  });
  app = createTestApp(t);
  scratch = await realpath(await mkdtemp(join(tmpdir(), 'spark-upstream-changes-')));
  upstream = join(scratch, 'upstream');
  clone = join(scratch, 'clone');
  await mkdir(upstream);
  git(upstream, 'init', '-q', '-b', 'main');
  await write(upstream, 'app.ts', 'one\n');
  await write(upstream, '.archived/Makefile', 'all:\n');
  commitAll(upstream, 'base');
  execFileSync('git', ['clone', '-q', upstream, clone]);
  git(clone, 'checkout', '-q', '-b', 'spark/chat');
});

afterEach(async () => {
  await worker.stop();
  await t.cleanup();
  await rm(scratch, { recursive: true, force: true });
});

describe(
  'files changed when the agent updates its branch during the run',
  { timeout: 60_000 },
  () => {
    it('counts only the agent’s edit after a fetch and fast-forward, and reverts only it', async () => {
      const { runId, taskId } = await finishedRun();
      await snapshotRun(t.db, runId, clone);
      await landUpstream(120);
      git(clone, 'fetch', '-q', 'origin');
      git(clone, 'merge', '-q', '--ff-only', 'origin/main');
      await write(clone, 'app.ts', 'two\n');

      expect(await runFiles(runId)).toEqual(['modified app.ts']);
      const task = taskChangesSchema.parse(
        (await get(`/api/tasks/${taskId}/changes`).expect(200)).body,
      );
      expect(task.runs[0]!.files).toEqual([
        expect.objectContaining({ path: 'app.ts', added: 1, removed: 1 }),
      ]);
      const diff = changeDiffSchema.parse(
        (
          await get(`/api/tasks/${taskId}/changes/diff`)
            .query({ runId, path: 'app.ts' })
            .expect(200)
        ).body,
      );
      expect(diff).toMatchObject({ oldText: 'one\n', newText: 'two\n' });

      await post(`/api/runs/${runId}/revert`, {}).expect(200);
      expect(await readFile(join(clone, 'app.ts'), 'utf8')).toBe('one\n');
      expect(git(clone, 'status', '--porcelain')).toBe('');
      expect(git(clone, 'ls-files', 'tools').split('\n')).toHaveLength(120);
    });

    it('counts the agent’s rebased commit and edit, not the newer main underneath', async () => {
      const { runId } = await finishedRun();
      await snapshotRun(t.db, runId, clone);
      await write(clone, 'feature.ts', 'export const feature = 1;\n');
      commitAll(clone, 'agent work');
      await landUpstream(30);
      git(clone, 'fetch', '-q', 'origin');
      git(clone, 'rebase', '-q', 'origin/main');
      await write(clone, 'app.ts', 'two\n');

      expect(await runFiles(runId)).toEqual(['added feature.ts', 'modified app.ts']);
    });
  },
);
