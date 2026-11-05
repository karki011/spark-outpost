import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PrWatch } from '@spark-outpost/contracts';
import { listen, type NotificationListener } from '../src/persistence/notifications.ts';
import type { FollowUpDeps } from '../src/pr-follow-up/deps.ts';
import { pollDue } from '../src/pr-follow-up/poller.ts';
import { conversationWatches } from '../src/pr-follow-up/view.ts';
import { memorySecretStore, type SecretStore } from '../src/setup/secrets.ts';
import { restConnection, type GitHubRequest } from '../src/ship/github/connection.ts';
import { honouringRateLimit } from '../src/ship/github/rate-limit.ts';
import {
  addPull,
  agentOpens,
  check,
  chatOnBranch,
  connectToken,
  pollDeps,
  type TrackedChat,
} from './pr-tracking-support.ts';
import { startGitHubStub, type GitHubStub } from './ship-support.ts';
import { createTestDb, eventually, testDatabaseUrl, type TestDb } from './support.ts';

let t: TestDb;
let base: string;
let stub: GitHubStub;
let secrets: SecretStore;
let chat: TrackedChat;
let clock: number;

const GADGETS_3 = 'https://github.com/acme/gadgets/pull/3';
const GADGETS_4 = 'https://github.com/acme/gadgets/pull/4';

beforeEach(async () => {
  t = await createTestDb();
  base = await realpath(await mkdtemp(path.join(tmpdir(), 'spark-pr-watching-')));
  stub = await startGitHubStub();
  secrets = memorySecretStore();
  chat = await chatOnBranch(t, base, 'widgets');
  clock = Date.now();
});

afterEach(async () => {
  await stub.close();
  await rm(base, { recursive: true, force: true });
  await t.cleanup();
});

const deps = (): FollowUpDeps => ({ ...pollDeps(t, stub, secrets), now: () => new Date(clock) });

async function viewsLater(using: FollowUpDeps = deps()): Promise<PrWatch[]> {
  clock += 31 * 60_000;
  await pollDue(using);
  const views = await conversationWatches(t.db, t.workspaceId, chat.conversationId);
  return views.toSorted((a, b) => a.number - b.number);
}

function failingWith(error: Error): FollowUpDeps {
  const request: GitHubRequest = async () => {
    throw error;
  };
  return { ...deps(), connect: async () => restConnection('token', 'github.com', request) };
}

describe('what the pull request view says about watching', () => {
  it('says when Spark last checked and when it checks next, with no problem', async () => {
    await connectToken(t, secrets);
    await agentOpens(t, chat, GADGETS_3);
    addPull(stub, 3, { repo: 'gadgets', checks: [check(1, 'test', 'in_progress', null)] });
    const [view] = await viewsLater();
    expect(view).toMatchObject({
      checks: 'pending',
      pollProblem: null,
      lastError: null,
      roundRunId: null,
      lastPolledAt: new Date(clock).toISOString(),
      nextPollAt: new Date(clock + 120_000).toISOString(),
    });
  });

  it('plans no next check once the pull request is merged', async () => {
    await connectToken(t, secrets);
    await agentOpens(t, chat, GADGETS_3);
    addPull(stub, 3, { repo: 'gadgets', state: 'closed', merged: true });
    expect((await viewsLater())[0]).toMatchObject({
      prState: 'merged',
      nextPollAt: null,
      pollProblem: null,
    });
  });

  it('names the round run only while the round is running', async () => {
    await agentOpens(t, chat, GADGETS_3);
    const set = (phase: string) =>
      t.db.query('UPDATE pr_watches SET phase = $1, round_run_id = $2, rounds = 1', [
        phase,
        chat.runId,
      ]);
    const view = async () =>
      (await conversationWatches(t.db, t.workspaceId, chat.conversationId))[0]!;
    await set('fixing');
    expect((await view()).roundRunId).toBe(chat.runId);
    await set('confirming');
    expect((await view()).roundRunId).toBeNull();
    await set('watching');
    expect((await view()).roundRunId).toBeNull();
  });
});

describe('why Spark could not check', () => {
  it('says GitHub is not connected', async () => {
    await agentOpens(t, chat, GADGETS_3);
    const [view] = await viewsLater();
    expect(view).toMatchObject({ pollProblem: 'not_connected' });
    expect(view!.unknownReason).toMatch(/^GitHub is not connected for github\.com/);
    expect(view!.nextPollAt).toBe(new Date(clock + 30 * 60_000).toISOString());
  });

  it('says the connection has no access, and clears it once a check works', async () => {
    await connectToken(t, secrets);
    await agentOpens(t, chat, GADGETS_3);
    expect((await viewsLater())[0]).toMatchObject({ pollProblem: 'no_access' });
    addPull(stub, 3, { repo: 'gadgets' });
    expect((await viewsLater())[0]).toMatchObject({
      pollProblem: null,
      unknownReason: null,
      lastError: null,
    });
  });

  it('marks every pull request on a rate-limited host, polled or not', async () => {
    await agentOpens(t, chat, GADGETS_3);
    await agentOpens(t, chat, GADGETS_4);
    const limited: GitHubRequest = async () => ({
      status: 403,
      data: { message: 'API rate limit exceeded' },
      header: (name) => (name === 'retry-after' ? '900' : null),
    });
    const limit = { until: 0 };
    const views = await viewsLater({
      ...deps(),
      connect: async () =>
        restConnection(
          'token',
          'github.com',
          honouringRateLimit(limited, limit, () => clock),
        ),
    });
    expect(views.map((view) => view.pollProblem)).toEqual(['rate_limit', 'rate_limit']);
    expect(views.map((view) => view.unknownReason)).toEqual([null, null]);
  });

  it('tells an unreachable GitHub from any other failed check', async () => {
    await agentOpens(t, chat, GADGETS_3);
    const unreachable = new TypeError('fetch failed', { cause: new Error('ENOTFOUND') });
    expect((await viewsLater(failingWith(unreachable)))[0]).toMatchObject({
      pollProblem: 'offline',
      lastError: 'fetch failed',
      unknownReason: null,
    });
    expect((await viewsLater(failingWith(new Error('Unexpected reply'))))[0]).toMatchObject({
      pollProblem: 'error',
      lastError: 'Unexpected reply',
    });
  });
});

describe('live updates for the indicator', () => {
  let listener: NotificationListener;
  let seen: string[];

  beforeEach(async () => {
    seen = [];
    listener = await listen(testDatabaseUrl(), 'changes', (payload) => {
      const change = JSON.parse(payload) as { kind: string; conversationId: string | null };
      if (change.conversationId === chat.conversationId) seen.push(change.kind);
    });
  });

  afterEach(async () => {
    await listener.close();
  });

  const pullEvents = () => seen.filter((kind) => kind === 'pull_request').length;

  async function delivered(): Promise<void> {
    await t.db.query('UPDATE conversations SET title = title || $2 WHERE id = $1', [
      chat.conversationId,
      '.',
    ]);
    await eventually(async () => seen.includes('conversation'));
  }

  async function quiet(): Promise<void> {
    await delivered();
    seen.length = 0;
  }

  it('announces a check that changed nothing while watching, not while a round runs', async () => {
    await connectToken(t, secrets);
    await agentOpens(t, chat, GADGETS_3);
    addPull(stub, 3, { repo: 'gadgets' });
    await viewsLater();
    await viewsLater();
    await quiet();

    await viewsLater();
    await eventually(async () => pullEvents() === 1);

    await t.db.query("UPDATE pr_watches SET phase = 'fixing'");
    await quiet();
    await t.db.query('UPDATE pr_watches SET last_polled_at = now(), next_poll_at = now()');
    await delivered();
    expect(pullEvents()).toBe(0);
  });
});
