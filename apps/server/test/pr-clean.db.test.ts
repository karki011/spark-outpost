import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prCleanAttentionKey } from '@spark-outpost/contracts';
import { listAttentionItems, markAttention } from '../src/persistence/attention-items.ts';
import { updateProfile } from '../src/persistence/setup.ts';
import { pullById } from '../src/persistence/tracked-pulls.ts';
import { pollWatch } from '../src/pr-follow-up/poller.ts';
import { conversationWatches } from '../src/pr-follow-up/view.ts';
import type { Worker } from '../src/workflow/worker.ts';
import { fakeFeedbackGitHub, type FakeFeedbackGitHub } from './fake-github-feedback.ts';
import { followUpDeps, openPull, startFakeWorker, type OpenPull } from './pr-follow-up-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let base: string;
let worker: Worker;
let fake: FakeFeedbackGitHub;
let pull: OpenPull;

const NEW_HEAD = 'abcdef0123456789abcdef0123456789abcdef01';
const passing = { id: 1, name: 'test', status: 'completed', conclusion: 'success' };
const alice = { login: 'alice' };

beforeAll(async () => {
  base = await realpath(await mkdtemp(path.join(tmpdir(), 'spark-pr-clean-')));
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

beforeEach(async (context) => {
  t = await createTestDb();
  worker = startFakeWorker(t);
  pull = await openPull(t, base, context.task.id);
  fake = fakeFeedbackGitHub({ sha: pull.sha, checkRuns: [passing] });
  await updateProfile(t.db, t.workspaceId, { prFollowUp: false });
});

afterEach(async () => {
  await worker.stop();
  await t.cleanup();
});

async function poll() {
  const current = (await pullById(t.db, pull.watch.id))!;
  return pollWatch(followUpDeps(t, fake, []), current);
}

async function cleanItems() {
  const items = await listAttentionItems(t.db, t.workspaceId, pull.conversationId);
  return items.filter((item) => item.kind === 'pr-clean');
}

async function shownClean() {
  const [view] = await conversationWatches(t.db, t.workspaceId, pull.conversationId);
  return view!.clean;
}

describe('a clean pull request', () => {
  it('shows once per head as a line and an update that never blocks', async () => {
    const first = await poll();
    expect(first.cleanHeadSha).toBe(pull.sha);
    expect(await shownClean()).toBe(true);
    expect(await cleanItems()).toEqual([
      expect.objectContaining({
        key: prCleanAttentionKey(pull.watch.id, pull.sha),
        blocking: false,
        detail: 'acme/widgets#7',
      }),
    ]);

    const again = await poll();
    expect(again.cleanSince?.getTime()).toBe(first.cleanSince?.getTime());
    await markAttention(t.db, t.workspaceId, prCleanAttentionKey(pull.watch.id, pull.sha), 'read');
    expect(await cleanItems()).toEqual([]);
  });

  it('hides on an open review thread and stays hidden until the head changes', async () => {
    await poll();
    fake.pull.reviewComments.push({ id: 31, user: alice, body: 'Rename this', path: 'a', line: 1 });
    await poll();
    expect(await shownClean()).toBe(false);
    expect(await cleanItems()).toEqual([]);

    fake.pull.resolvedThreads.push(31);
    await poll();
    expect(await shownClean()).toBe(false);

    fake.pull.sha = NEW_HEAD;
    await poll();
    expect(await shownClean()).toBe(true);
    expect((await cleanItems()).map((item) => item.key)).toEqual([
      prCleanAttentionKey(pull.watch.id, NEW_HEAD),
    ]);
  });

  it('is not clean while checks run, changes are requested or it is a draft', async () => {
    fake.pull.checkRuns = [{ ...passing, status: 'in_progress', conclusion: null }];
    await poll();
    expect(await shownClean()).toBe(false);

    fake.pull.checkRuns = [passing];
    fake.pull.reviews.push({ id: 41, user: alice, body: 'No', state: 'CHANGES_REQUESTED' });
    await poll();
    expect(await shownClean()).toBe(false);

    fake.pull.reviews = [];
    fake.pull.draft = true;
    await poll();
    expect(await shownClean()).toBe(false);
  });
});
