import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { SPARK_ACTION_OPTION, taskOverviewSchema } from '@spark-outpost/contracts';
import { getRun } from '../src/persistence/runs.ts';
import { snapshotRun } from '../src/projects/run-changes.ts';
import { createFakeProvider } from '../src/providers/fake.ts';
import { runCommand } from '../src/setup/command.ts';
import { startWorker, type Worker } from '../src/workflow/worker.ts';
import { createTestApp, LOCAL_HEADERS, ORIGIN } from './app-support.ts';
import {
  FAKE_GH,
  repoWithRemote,
  startGitHubStub,
  write,
  type GitHubStub,
} from './ship-support.ts';
import {
  answerCard,
  recordedHooks,
  startSparkTools,
  type RecordedHooks,
  type SparkToolsHarness,
} from './spark-mcp-support.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

let t: TestDb;
let worker: Worker;
let base: string;
let stub: GitHubStub;
let app: ReturnType<typeof createTestApp>;
let recorded: RecordedHooks;
let tools: SparkToolsHarness | null = null;

const ghState = () => path.join(base, 'gh-state');
const detailSchema = z.object({ tasks: z.array(taskOverviewSchema) });
const post = (url: string, body: object) =>
  request(app).post(url).set(LOCAL_HEADERS).set('Origin', ORIGIN).send(body);

beforeAll(async () => {
  base = await realpath(await mkdtemp(path.join(tmpdir(), 'spark-open-pr-')));
  process.env.FAKE_GH_NODE = process.execPath;
  process.env.FAKE_GH_STATE = ghState();
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

beforeEach(async () => {
  t = await createTestDb();
  stub = await startGitHubStub();
  process.env.FAKE_GH_API = stub.url;
  await writeFile(ghState(), 'octo-cli');
  const provider = createFakeProvider({ stepMs: 0, wordMs: 0 });
  worker = startWorker({
    db: t.db,
    providers: new Map([[provider.name, provider]]),
    leaseSeconds: 30,
    concurrency: 1,
    pollMs: 20,
  });
  app = createTestApp(t, {
    runCommand,
    fetch,
    githubApiUrl: stub.url,
    locateGh: async () => FAKE_GH,
  });
  recorded = recordedHooks();
});

afterEach(async () => {
  recorded.stop();
  await tools?.close();
  tools = null;
  await worker.stop();
  await stub.close();
  await t.cleanup();
});

async function editedChat(root: string) {
  const conversationId = randomUUID();
  await post('/api/conversations', { id: conversationId }).expect(201);
  const sent = await post(`/api/conversations/${conversationId}/messages`, {
    id: randomUUID(),
    content: 'Tidy the notes #plan',
  }).expect(201);
  const runId = sent.body.run.id as string;
  await eventually(async () => (await getRun(t.db, runId))?.finishedAt, 15_000);
  await snapshotRun(t.db, runId, root);
  await write(root, 'notes.txt', 'one\ntwo\n');
  const detail = detailSchema.parse(
    (await request(app).get(`/api/conversations/${conversationId}`).set(LOCAL_HEADERS)).body,
  );
  return { conversationId, runId, taskId: detail.tasks[0]!.id };
}

async function open(conversationId: string, runId: string) {
  tools = await startSparkTools(
    t,
    { conversationId, runId, actions: recorded.hooks },
    {
      github: { runCommand, locateGh: async () => FAKE_GH, apiUrl: stub.url },
    },
  );
  return tools;
}

describe('spark_open_pr', { timeout: 60_000 }, () => {
  it('opens a draft PR through Ship with the confirmed title and description', async () => {
    const repo = await repoWithRemote(base, 'pr');
    const { conversationId, runId, taskId } = await editedChat(repo.root);
    const harness = await open(conversationId, runId);

    const call = harness.call('spark_open_pr', {
      title: 'Tidy notes',
      body: 'Adds a second line to the notes.',
    });
    const card = await answerCard(t, SPARK_ACTION_OPTION.confirm, {
      edits: { title: 'Tidy the notes file' },
    });
    const result = (await call).json<{ outcome: string; url: string; number: number }>();

    expect(card.payload.sparkAction).toMatchObject({
      action: 'open_pr',
      taskId,
      base: 'main',
      repo: 'acme/widgets',
      files: [{ path: 'notes.txt', change: 'modified' }],
    });
    expect(result).toMatchObject({
      outcome: 'done',
      number: 1,
      url: 'https://github.com/acme/widgets/pull/1',
    });
    expect(stub.github.pulls[0]).toMatchObject({ title: 'Tidy the notes file', draft: true });
    expect(stub.github.pulls[0]!.body).toContain('Adds a second line to the notes.');
    expect(JSON.stringify(recorded.audited)).toContain('spark/open_pr');
  });

  it('pushes nothing when the user declines', async () => {
    const repo = await repoWithRemote(base, 'declined');
    const { conversationId, runId } = await editedChat(repo.root);
    const harness = await open(conversationId, runId);

    const call = harness.call('spark_open_pr', { title: 'Nope' });
    await answerCard(t, SPARK_ACTION_OPTION.decline);

    expect((await call).json()).toMatchObject({ outcome: 'declined' });
    expect(stub.github.pulls).toEqual([]);
  });

  it('explains when the chat has nothing to ship', async () => {
    const harness = await open(randomUUID(), randomUUID());
    const result = await harness.call('spark_open_pr', { title: 'x' });
    expect(result).toMatchObject({ isError: true, text: expect.stringContaining('no changes') });
  });
});
