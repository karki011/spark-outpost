import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { updateProfile } from '../src/persistence/setup.ts';
import type { TrackedPull } from '../src/persistence/tracked-pulls.ts';
import type { FollowUpDeps } from '../src/pr-follow-up/deps.ts';
import { pollDue, startPrFollowUp } from '../src/pr-follow-up/poller.ts';
import { conversationWatches } from '../src/pr-follow-up/view.ts';
import { memorySecretStore, type SecretStore } from '../src/setup/secrets.ts';
import { restConnection, type GitHubRequest } from '../src/ship/github/connection.ts';
import { honouringRateLimit } from '../src/ship/github/rate-limit.ts';
import type { FakePull } from './fake-github.ts';
import {
  addPull,
  agentOpens,
  check,
  chatOnBranch,
  connectToken,
  pollDeps,
  tracked,
  type TrackedChat,
} from './pr-tracking-support.ts';
import { startGitHubStub, type GitHubStub } from './ship-support.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

let t: TestDb;
let base: string;
let stub: GitHubStub;
let secrets: SecretStore;
let chat: TrackedChat;
let clock: number;

const GADGETS_3 = 'https://github.com/acme/gadgets/pull/3';
const GADGETS_4 = 'https://github.com/acme/gadgets/pull/4';
const WIDGETS_7 = 'https://github.com/acme/widgets/pull/7';

beforeEach(async () => {
  t = await createTestDb();
  base = await realpath(await mkdtemp(path.join(tmpdir(), 'spark-pr-status-')));
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

async function pollLater(using: FollowUpDeps = deps()): Promise<TrackedPull[]> {
  clock += 31 * 60_000;
  await pollDue(using);
  return tracked(t, chat.conversationId);
}

async function outsidePull(fields: Partial<FakePull> = {}): Promise<FakePull> {
  await agentOpens(t, chat, GADGETS_3);
  return addPull(stub, 3, { repo: 'gadgets', head: 'fix-docs', title: 'Fix the docs', ...fields });
}

describe('the status of a tracked pull request', () => {
  it('follows checks from pending to failing to passing, failing only once every run ended', async () => {
    await connectToken(t, secrets);
    const pull = await outsidePull({
      checks: [check(1, 'test', 'completed', 'failure'), check(2, 'build', 'in_progress', null)],
    });

    expect((await pollLater())[0]).toMatchObject({
      title: 'Fix the docs',
      branch: 'fix-docs',
      base: 'main',
      checks: 'pending',
      failingChecks: [],
      statusReason: null,
      phase: 'watching',
    });

    pull.checks = [
      check(1, 'test', 'completed', 'failure'),
      check(2, 'build', 'completed', 'success'),
      check(3, 'e2e', 'completed', 'timed_out'),
    ];
    expect((await pollLater())[0]).toMatchObject({
      checks: 'failing',
      failingChecks: [
        { name: 'test', url: 'https://github.com/acme/widgets/actions/runs/1' },
        { name: 'e2e', url: 'https://github.com/acme/widgets/actions/runs/3' },
      ],
    });

    pull.checks = pull.checks.map((run) => ({ ...run, conclusion: 'success' }));
    expect((await pollLater())[0]).toMatchObject({ checks: 'passing', failingChecks: [] });
  });

  it('polls sooner while checks run and backs off once nothing changes', async () => {
    await connectToken(t, secrets);
    const pull = await outsidePull({ checks: [check(1, 'test', 'queued', null)] });
    expect((await pollLater())[0]!.intervalSeconds).toBe(120);
    pull.checks = [check(1, 'test', 'completed', 'success')];
    expect((await pollLater())[0]!.intervalSeconds).toBe(120);
    expect((await pollLater())[0]!.intervalSeconds).toBe(240);
    expect((await pollLater())[0]!.intervalSeconds).toBe(480);
  });

  it('shows the review verdict from each reviewer’s latest review', async () => {
    await connectToken(t, secrets);
    const pull = await outsidePull({
      reviews: [
        { user: { login: 'alice' }, state: 'APPROVED' },
        { user: { login: 'bob' }, state: 'COMMENTED' },
      ],
    });
    expect((await pollLater())[0]!.review).toBe('approved');

    pull.reviews!.push({ user: { login: 'bob' }, state: 'CHANGES_REQUESTED' });
    expect((await pollLater())[0]!.review).toBe('changes_requested');
    const [view] = await conversationWatches(t.db, t.workspaceId, chat.conversationId);
    expect(view).toMatchObject({ review: 'changes_requested', unknownReason: null });
  });

  it('stops tracking a merged pull request and keeps showing it', async () => {
    await connectToken(t, secrets);
    await outsidePull({ state: 'closed', merged: true });
    expect((await pollLater())[0]).toMatchObject({
      prState: 'merged',
      phase: 'done',
      doing: 'The PR was merged. Spark stopped tracking it.',
    });
    const reads = stub.github.requests.length;
    await pollLater();
    expect(stub.github.requests).toHaveLength(reads);
  });

  it('stops following up, but keeps tracking, a pull request from another branch', async () => {
    await connectToken(t, secrets);
    await agentOpens(t, chat, WIDGETS_7);
    addPull(stub, 7, {
      head: 'feature/side-quest',
      checks: [check(1, 'test', 'completed', 'failure')],
    });
    expect((await pollLater())[0]).toMatchObject({
      branch: 'feature/side-quest',
      followUp: false,
      checks: 'failing',
      rounds: 0,
    });
  });

  it('keeps tracking checks when PR follow-up is off in Settings', async () => {
    await connectToken(t, secrets);
    await updateProfile(t.db, t.workspaceId, { prFollowUp: false });
    await agentOpens(t, chat, WIDGETS_7);
    addPull(stub, 7, { checks: [check(1, 'test', 'completed', 'failure')] });
    expect((await pollLater())[0]).toMatchObject({
      followUp: true,
      checks: 'failing',
      doing: 'PR follow-up is off in Settings.',
      rounds: 0,
    });
  });
});

describe('when GitHub cannot be read', () => {
  it('says the status is unknown because GitHub is not connected', async () => {
    await outsidePull();
    const [pull] = await pollLater();
    expect(pull).toMatchObject({ checks: 'none', prState: 'open', intervalSeconds: 1800 });
    expect(pull!.statusReason).toBe(
      'GitHub is not connected for github.com, so Spark can’t read this pull request. Connect GitHub in Settings.',
    );
    const [view] = await conversationWatches(t.db, t.workspaceId, chat.conversationId);
    expect(view!.unknownReason).toBe(pull!.statusReason);
  });

  it('says the connection cannot read the repository, then recovers once it can', async () => {
    await connectToken(t, secrets);
    await agentOpens(t, chat, GADGETS_3);
    expect((await pollLater())[0]!.statusReason).toBe(
      'Your GitHub connection can’t read acme/gadgets (404). Give it access to this repository to see checks and reviews.',
    );
    addPull(stub, 3, { repo: 'gadgets', checks: [check(1, 'test', 'completed', 'success')] });
    expect((await pollLater())[0]).toMatchObject({
      statusReason: null,
      lastError: null,
      checks: 'passing',
    });
  });

  it('pauses every pull request on a host whose rate limit ran out', async () => {
    await agentOpens(t, chat, GADGETS_3);
    await agentOpens(t, chat, GADGETS_4);
    const calls: string[] = [];
    const limited: GitHubRequest = async (_method, route) => {
      calls.push(route);
      return {
        status: 403,
        data: { message: 'API rate limit exceeded' },
        header: (name) => (name === 'retry-after' ? '900' : null),
      };
    };
    const limit = { until: 0 };
    const using: FollowUpDeps = {
      ...deps(),
      connect: async () =>
        restConnection(
          'token',
          'github.com',
          honouringRateLimit(limited, limit, () => clock),
        ),
    };

    const before = clock;
    const pulls = await pollLater(using);
    expect(calls).toHaveLength(1);
    for (const pull of pulls) {
      expect(pull.lastError).toMatch(/^GitHub's rate limit is used up\. Try again after /);
      expect(pull.nextPollAt.getTime()).toBeGreaterThanOrEqual(before + 60 * 60_000);
      expect(pull.statusReason).toBeNull();
    }
    clock += 60_000;
    expect(await pollDue(using)).toBe(0);
    expect(calls).toHaveLength(1);
  });
});

describe('after a restart', () => {
  it('keeps the tracked pull requests and polls them again', async () => {
    await connectToken(t, secrets);
    const pull = await outsidePull({ checks: [check(1, 'test', 'in_progress', null)] });
    const real = pollDeps(t, stub, secrets);

    const first = startPrFollowUp(real, 20);
    await eventually(async () => {
      const [seen] = await tracked(t, chat.conversationId);
      return seen?.checks === 'pending' ? seen : null;
    }, 10_000);
    await first.stop();

    pull.checks = [check(1, 'test', 'completed', 'success')];
    await t.db.query('UPDATE pr_watches SET next_poll_at = now()');
    const second = startPrFollowUp(real, 20);
    const after = await eventually(async () => {
      const [seen] = await tracked(t, chat.conversationId);
      return seen?.checks === 'passing' ? seen : null;
    }, 10_000);
    await second.stop();
    expect(after).toMatchObject({ number: 3, openedVia: 'agent', title: 'Fix the docs' });
  });
});
