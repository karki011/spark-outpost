import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { shipResultSchema } from '@spark-outpost/contracts';
import { getRun } from '../src/persistence/runs.ts';
import { cacheTickets, linkTaskTicket } from '../src/persistence/tickets.ts';
import { snapshotRun } from '../src/projects/run-changes.ts';
import { createFakeProvider } from '../src/providers/fake.ts';
import { memorySecretStore, type SecretStore } from '../src/setup/secrets.ts';
import { startWorker, type Worker } from '../src/workflow/worker.ts';
import { createTestApp, LOCAL_HEADERS, ORIGIN } from './app-support.ts';
import { LINEAR_KEY } from './fake-linear.ts';
import {
  FAKE_GH,
  repoWithRemote,
  startGitHubStub,
  write,
  type GitHubStub,
} from './ship-support.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';
import { startTicketStubs, type TicketStubs } from './ticket-support.ts';

let t: TestDb;
let worker: Worker;
let base: string;
let github: GitHubStub;
let stubs: TicketStubs;
let secrets: SecretStore;
let app: ReturnType<typeof createTestApp>;

const ghState = () => path.join(base, 'gh-state');

beforeAll(async () => {
  base = await realpath(await mkdtemp(path.join(tmpdir(), 'spark-ticket-ship-')));
  process.env.FAKE_GH_NODE = process.execPath;
  process.env.FAKE_GH_STATE = ghState();
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

beforeEach(async () => {
  t = await createTestDb();
  github = await startGitHubStub();
  stubs = await startTicketStubs();
  process.env.FAKE_GH_API = github.url;
  secrets = memorySecretStore();
  const provider = createFakeProvider({ stepMs: 0, wordMs: 0 });
  worker = startWorker({
    db: t.db,
    providers: new Map([[provider.name, provider]]),
    leaseSeconds: 30,
    concurrency: 1,
    pollMs: 20,
  });
  const { runCommand } = await import('../src/setup/command.ts');
  app = createTestApp(t, {
    secrets,
    runCommand,
    fetch,
    githubApiUrl: github.url,
    linearApiUrl: stubs.linearUrl,
    locateGh: async () => FAKE_GH,
  });
  await writeFile(ghState(), 'octo-cli');
});

afterEach(async () => {
  await worker.stop();
  await github.close();
  await stubs.close();
  await t.cleanup();
});

const post = (url: string, body: object) =>
  request(app).post(url).set(LOCAL_HEADERS).set('Origin', ORIGIN).send(body);
const put = (url: string, body: object) =>
  request(app).put(url).set(LOCAL_HEADERS).set('Origin', ORIGIN).send(body);
const get = (url: string) => request(app).get(url).set(LOCAL_HEADERS);

async function ticketTask(root: string) {
  const conversationId = randomUUID();
  await post('/api/conversations', { id: conversationId }).expect(201);
  const sent = await post(`/api/conversations/${conversationId}/messages`, {
    id: randomUUID(),
    content: 'Fix the divider #plan',
  }).expect(201);
  const runId = sent.body.run.id as string;
  await eventually(async () => (await getRun(t.db, runId))?.finishedAt, 15_000);
  const detail = (await get(`/api/conversations/${conversationId}`).expect(200)).body;
  const taskId = detail.tasks[0].id as string;
  await snapshotRun(t.db, runId, root);
  await write(root, 'notes.txt', 'one\ntwo\n');
  const ticket = (await get('/api/tickets?source=linear').expect(200)).body.tickets[0];
  await cacheTickets(t.db, t.workspaceId, [ticket]);
  await linkTaskTicket(t.db, t.workspaceId, taskId, ticket);
  return taskId;
}

describe('Ship with a linked ticket', { timeout: 60_000 }, () => {
  it('adds the draft PR to the ticket and moves it to In review', async () => {
    await put('/api/tickets/connections/linear', { source: 'linear', apiKey: LINEAR_KEY }).expect(
      200,
    );
    const repo = await repoWithRemote(base, 'ticketed');
    const taskId = await ticketTask(repo.root);

    const shipped = shipResultSchema.parse(
      (
        await post(`/api/tasks/${taskId}/ship`, {
          mode: 'draft_pr',
          title: 'Fix the divider',
        }).expect(200)
      ).body,
    );
    expect(shipped.pullRequest?.url).toBe('https://github.com/acme/widgets/pull/1');

    const issue = stubs.linear.issues[0]!;
    expect(issue.attachments).toEqual([
      { title: 'acme/widgets#1', url: 'https://github.com/acme/widgets/pull/1' },
    ]);
    expect(issue.stateId).toBe('eng-review');
    const listed = (await get('/api/tickets?source=linear&status=in_review').expect(200)).body;
    expect(listed.tickets[0]).toMatchObject({
      key: 'ENG-12',
      work: [
        {
          taskId,
          pullRequests: expect.arrayContaining([
            { title: 'acme/widgets#1', url: 'https://github.com/acme/widgets/pull/1' },
          ]),
        },
      ],
    });
  });

  it('still ships when the ticket source fails', async () => {
    await put('/api/tickets/connections/linear', { source: 'linear', apiKey: LINEAR_KEY }).expect(
      200,
    );
    const repo = await repoWithRemote(base, 'offline');
    const taskId = await ticketTask(repo.root);
    await secrets.set('ticket:linear', 'lin_api_revoked_0123456789abcdefghij');

    await post(`/api/tasks/${taskId}/ship`, { mode: 'draft_pr', title: 'Fix the divider' }).expect(
      200,
    );
    expect(github.github.pulls).toHaveLength(1);
    const { rows } = await t.db.query<{ action: string; outcome: string }>(
      `SELECT action, outcome FROM ticket_events WHERE task_id = $1 ORDER BY at, id`,
      [taskId],
    );
    expect(rows).toEqual([
      { action: 'link_pr', outcome: 'failed' },
      { action: 'transition', outcome: 'failed' },
    ]);
  });
});
