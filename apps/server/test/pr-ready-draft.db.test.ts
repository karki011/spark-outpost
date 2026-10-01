import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { z } from 'zod';
import { prWatchListSchema, shipResultSchema, taskOverviewSchema } from '@spark-outpost/contracts';
import { getRun } from '../src/persistence/runs.ts';
import { snapshotRun } from '../src/projects/run-changes.ts';
import { runCommand } from '../src/setup/command.ts';
import type { Worker } from '../src/workflow/worker.ts';
import { createTestApp, LOCAL_HEADERS, ORIGIN } from './app-support.ts';
import { startFakeWorker } from './pr-follow-up-support.ts';
import {
  FAKE_GH,
  repoWithRemote,
  startGitHubStub,
  write,
  type GitHubStub,
} from './ship-support.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

let t: TestDb;
let worker: Worker;
let base: string;
let stub: GitHubStub;
let app: ReturnType<typeof createTestApp>;

const detailSchema = z.object({ tasks: z.array(taskOverviewSchema) });
const send = (method: 'post' | 'patch', url: string, body: object) =>
  request(app)[method](url).set(LOCAL_HEADERS).set('Origin', ORIGIN).send(body);
const get = (url: string) => request(app).get(url).set(LOCAL_HEADERS);

beforeAll(async () => {
  base = await realpath(await mkdtemp(path.join(tmpdir(), 'spark-ready-draft-')));
  process.env.FAKE_GH_NODE = process.execPath;
  process.env.FAKE_GH_STATE = path.join(base, 'gh-state');
  await writeFile(path.join(base, 'gh-state'), 'octo-cli');
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

beforeEach(async () => {
  t = await createTestDb();
  stub = await startGitHubStub();
  process.env.FAKE_GH_API = stub.url;
  worker = startFakeWorker(t);
  app = createTestApp(t, {
    runCommand,
    fetch,
    githubApiUrl: stub.url,
    locateGh: async () => FAKE_GH,
  });
});

afterEach(async () => {
  await worker.stop();
  await stub.close();
  await t.cleanup();
});

async function shippedChat(name: string) {
  const repo = await repoWithRemote(base, name);
  const conversationId = randomUUID();
  await send('post', '/api/conversations', { id: conversationId }).expect(201);
  const sent = await send('post', `/api/conversations/${conversationId}/messages`, {
    id: randomUUID(),
    content: `Tidy the ${name} notes #plan`,
  }).expect(201);
  const runId = sent.body.run.id as string;
  await eventually(async () => (await getRun(t.db, runId))?.finishedAt, 15_000);
  await snapshotRun(t.db, runId, repo.root);
  await write(repo.root, 'notes.txt', `one\n${name}\n`);
  const detail = detailSchema.parse((await get(`/api/conversations/${conversationId}`)).body);
  const taskId = detail.tasks[0]!.id;
  const shipped = await send('post', `/api/tasks/${taskId}/ship`, { mode: 'draft_pr' }).expect(200);
  return { conversationId, result: shipResultSchema.parse(shipped.body) };
}

it('opens PRs ready for review by default, as drafts when Settings say so, and watches each one', async () => {
  const ready = await shippedChat('ready');
  expect(ready.result.pullRequest).toMatchObject({ number: 1, created: true, draft: false });
  expect(stub.github.pulls[0]).toMatchObject({ draft: false });

  await send('patch', '/api/profile', { prReadyForReview: false }).expect(200);
  const drafted = await shippedChat('drafted');
  expect(drafted.result.pullRequest).toMatchObject({ number: 2, created: true, draft: true });
  expect(stub.github.pulls[1]).toMatchObject({ draft: true });

  const watched = prWatchListSchema.parse(
    (await get(`/api/conversations/${drafted.conversationId}/pull-requests`).expect(200)).body,
  );
  expect(watched.watches).toEqual([
    expect.objectContaining({
      number: 2,
      repo: 'acme/widgets',
      phase: 'watching',
      draft: true,
      branch: drafted.result.branch,
      items: [],
    }),
  ]);
}, 60_000);
