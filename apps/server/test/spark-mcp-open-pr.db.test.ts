import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { SPARK_ACTION_OPTION, taskOverviewSchema } from '@spark-outpost/contracts';
import { getApproval } from '../src/persistence/approvals.ts';
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
  confirmCard,
  fullAutoChat,
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
  it('opens a PR through Ship with the confirmed title and description', async () => {
    const repo = await repoWithRemote(base, 'pr');
    const { conversationId, runId, taskId } = await editedChat(repo.root);
    const harness = await open(conversationId, runId);

    const waiting = await harness.call('spark_open_pr', {
      title: 'Tidy notes',
      body: 'Adds a second line to the notes.',
    });
    const card = await confirmCard(t, { edits: { title: 'Tidy the notes file' } });

    expect(card.payload.sparkAction).toMatchObject({
      action: 'open_pr',
      taskId,
      base: 'main',
      repo: 'acme/widgets',
      files: [{ path: 'notes.txt', change: 'modified' }],
    });
    expect(waiting.json()).toMatchObject({ outcome: 'waiting_for_user', approvalId: card.id });
    expect(card.payload.sparkResult).toMatchObject({
      state: 'done',
      message: 'Opened PR #1.',
      url: 'https://github.com/acme/widgets/pull/1',
      output: { number: 1 },
    });
    expect(stub.github.pulls[0]).toMatchObject({ title: 'Tidy the notes file', draft: false });
    expect(stub.github.pulls[0]!.body).toContain('Adds a second line to the notes.');
    expect(JSON.stringify(recorded.audited)).toContain('spark/open_pr');
  });

  it('pushes nothing when the user declines', async () => {
    const repo = await repoWithRemote(base, 'declined');
    const { conversationId, runId } = await editedChat(repo.root);
    const harness = await open(conversationId, runId);

    await harness.call('spark_open_pr', { title: 'Nope' });
    const card = await answerCard(t, SPARK_ACTION_OPTION.decline);
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect((await getApproval(t.db, card.id))?.status).toBe('denied');
    expect(stub.github.pulls).toEqual([]);
  });

  it('opens the PR without a card at Full auto → PR', async () => {
    const repo = await repoWithRemote(base, 'full-auto');
    const { conversationId, runId } = await editedChat(repo.root);
    await fullAutoChat(t, conversationId);
    const harness = await open(conversationId, runId);

    const result = await harness.call('spark_open_pr', { title: 'Tidy notes' });

    expect(result.json()).toMatchObject({
      outcome: 'done',
      url: 'https://github.com/acme/widgets/pull/1',
      number: 1,
    });
    expect(stub.github.pulls).toHaveLength(1);
    const { rows } = await t.db.query<{ status: string; decided_by: string }>(
      `SELECT status, decided_by FROM approvals WHERE kind = 'spark_action'`,
    );
    expect(rows).toEqual([{ status: 'allowed', decided_by: 'level' }]);
  });

  it('opens the PR without a card when the agent runs in Bypass permissions', async () => {
    const repo = await repoWithRemote(base, 'bypass');
    const { conversationId, runId } = await editedChat(repo.root);
    await t.db.query(
      `UPDATE runs SET provider = 'claude', used_mode = 'bypassPermissions' WHERE id = $1`,
      [runId],
    );
    const harness = await open(conversationId, runId);

    const result = await harness.call('spark_open_pr', { title: 'Tidy notes' });

    expect(result.json()).toMatchObject({ outcome: 'done', number: 1 });
    expect(stub.github.pulls[0]).toMatchObject({ title: 'Tidy notes' });
  });

  it('explains when the chat has nothing to ship', async () => {
    const harness = await open(randomUUID(), randomUUID());
    const result = await harness.call('spark_open_pr', { title: 'x' });
    expect(result).toMatchObject({ isError: true, text: expect.stringContaining('no changes') });
  });
});
