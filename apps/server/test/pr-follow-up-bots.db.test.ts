import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { feedbackFor } from '../src/persistence/pr-watches.ts';
import { updateProfile } from '../src/persistence/setup.ts';
import { watchView } from '../src/pr-follow-up/view.ts';
import { pollWatch } from '../src/pr-follow-up/poller.ts';
import { QUIET_LINE } from '../src/pr-follow-up/rounds.ts';
import type { Worker } from '../src/workflow/worker.ts';
import { fakeFeedbackGitHub, type FakeFeedbackGitHub } from './fake-github-feedback.ts';
import {
  current,
  finishedRun,
  followUpDeps,
  openPull,
  setReply,
  startFakeWorker,
  type OpenPull,
  type RoundCall,
} from './pr-follow-up-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let base: string;
let worker: Worker;
let fake: FakeFeedbackGitHub;
let rounds: RoundCall[];
let pull: OpenPull;

const rabbit = { login: 'coderabbitai[bot]' };
const copilot = { login: 'copilot[bot]' };

const botComment = (id: number, user = rabbit, line = 1) => ({
  id,
  user,
  body: 'Handle the empty list here.',
  path: 'notes.txt',
  line,
});

beforeAll(async () => {
  base = await realpath(await mkdtemp(path.join(tmpdir(), 'spark-pr-bots-')));
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

beforeEach(async (context) => {
  t = await createTestDb();
  worker = startFakeWorker(t);
  pull = await openPull(t, base, context.task.id);
  fake = fakeFeedbackGitHub({ sha: pull.sha });
  rounds = [];
});

afterEach(async () => {
  await worker.stop();
  await t.cleanup();
});

const deps = () => followUpDeps(t, fake, rounds);
const poll = async () => pollWatch(deps(), await current(t, pull.watch));

async function roundEnds(reply: string) {
  const round = rounds.at(-1)!;
  await finishedRun(t, round.runId);
  await setReply(t, round.runId, reply);
  return poll();
}

describe('review bots to act on', { timeout: 60_000 }, () => {
  it('acts on a listed bot like a reviewer and leaves an unlisted bot as Not acted on', async () => {
    await updateProfile(t.db, t.workspaceId, { prFollowUpBots: ['CodeRabbitAI[bot]'] });
    fake.pull.reviewComments = [botComment(21), botComment(22, copilot, 2)];
    const watch = await poll();
    expect(watch.phase).toBe('fixing');
    expect(rounds).toHaveLength(1);
    expect(rounds[0]!.content).toContain('review comment by coderabbitai[bot]');
    expect(rounds[0]!.content).not.toContain('copilot[bot]');
    const items = await feedbackFor(t.db, pull.watch.id);
    expect(items.map((item) => [item.author, item.trusted, item.state])).toEqual([
      ['coderabbitai[bot]', true, 'in_round'],
      ['copilot[bot]', false, 'held'],
    ]);
  });

  it('hands a listed bot that repeats a pushed-back request to the user, not another round', async () => {
    await updateProfile(t.db, t.workspaceId, { prFollowUpBots: ['coderabbitai[bot]'] });
    fake.pull.reviewComments = [botComment(21)];
    await poll();
    await roundEnds('[F1] pushed back: The caller already rejects an empty list.');
    expect(fake.posted).toHaveLength(1);
    fake.pull.reviewComments = [botComment(21), botComment(23)];
    const watch = await poll();
    expect(rounds).toHaveLength(1);
    expect(watch.phase).toBe('needs_you');
    const repeated = (await feedbackFor(t.db, pull.watch.id)).find(
      (item) => item.githubId === '23',
    );
    expect(repeated?.state).toBe('needs_user');
  });
});

describe('no round cap: a round that changes nothing stops follow-up', { timeout: 60_000 }, () => {
  it('stops after a round with no push and no reply, through duplicates and a restart', async () => {
    fake.pull.reviewComments = [{ ...botComment(21), user: { login: 'alice' } }];
    await poll();
    const quiet = await roundEnds('[F1] left for you: This changes the scope of the task.');
    expect(quiet).toMatchObject({ quietHead: pull.sha, phase: 'needs_you' });
    expect(quiet.doing).toContain(QUIET_LINE);
    expect((await watchView(t.db, quiet)).quiet).toBe(true);

    const again = await poll();
    expect(again.quietHead).toBe(pull.sha);
    expect(again.doing).toBe(QUIET_LINE);
    expect(rounds).toHaveLength(1);

    const restarted = await current(t, pull.watch);
    expect(restarted.quietHead).toBe(pull.sha);
    expect((await pollWatch(deps(), restarted)).quietHead).toBe(pull.sha);
    expect(rounds).toHaveLength(1);
  });

  it('starts again on new review activity', async () => {
    fake.pull.reviewComments = [{ ...botComment(21), user: { login: 'alice' } }];
    await poll();
    await roundEnds('[F1] left for you: This changes the scope of the task.');
    fake.pull.issueComments = [{ id: 31, user: { login: 'alice' }, body: 'Please add a test.' }];
    const resumed = await poll();
    expect(resumed).toMatchObject({ phase: 'fixing', quietHead: null, rounds: 2 });
    expect(rounds).toHaveLength(2);
  });

  it('wakes on a new head even with nothing new to fix', async () => {
    fake.pull.reviewComments = [{ ...botComment(21), user: { login: 'alice' } }];
    await poll();
    await roundEnds('[F1] left for you: This changes the scope of the task.');
    fake.pull.sha = 'f'.repeat(40);
    const woken = await poll();
    expect(woken.quietHead).toBeNull();
    expect(woken.doing).not.toContain(QUIET_LINE);
  });
});

describe('reviewers already on the pull request', { timeout: 60_000 }, () => {
  it('collects requested people and teams and who reviewed, and keeps them after they leave', async () => {
    fake.pull.requestedReviewers = [{ login: 'Bob' }];
    fake.pull.requestedTeams = [{ slug: 'core' }];
    fake.pull.reviews = [{ id: 41, user: rabbit, body: '', state: 'COMMENTED' }];
    await poll();
    expect((await current(t, pull.watch)).knownReviewers).toEqual([
      'acme/core',
      'bob',
      'coderabbitai[bot]',
    ]);
    fake.pull.requestedReviewers = [];
    fake.pull.requestedTeams = [];
    await poll();
    expect((await current(t, pull.watch)).knownReviewers).toEqual([
      'acme/core',
      'bob',
      'coderabbitai[bot]',
    ]);
  });

  it('tells the round agent who it may ask again and how to update a conflicting branch', async () => {
    fake.pull.requestedReviewers = [{ login: 'bob' }];
    fake.pull.mergeableState = 'dirty';
    fake.pull.baseRef = 'main';
    fake.pull.reviewComments = [{ ...botComment(21), user: { login: 'alice' } }];
    await poll();
    expect(rounds[0]!.content).toContain('re-request review on PR #7 from reviewers already on it');
    expect(rounds[0]!.content).toContain('(bob)');
    expect(rounds[0]!.content).toContain('merge conflicts between this branch and main');
  });
});
