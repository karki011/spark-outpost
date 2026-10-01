import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SPARK_ACTION_OPTION, type PrFollowUpAction } from '@spark-outpost/contracts';
import { decideApproval, getApproval } from '../src/persistence/approvals.ts';
import {
  dueWatches,
  feedbackFor,
  prFeedbackWaiting,
  saveWatch,
} from '../src/persistence/pr-watches.ts';
import { getRun } from '../src/persistence/runs.ts';
import { updateProfile } from '../src/persistence/setup.ts';
import { sendRoundMessage } from '../src/pr-follow-up/deps.ts';
import { SPARK_REPLY_MARKER } from '../src/pr-follow-up/gather.ts';
import { pollDue, pollWatch } from '../src/pr-follow-up/poller.ts';
import { LIMIT_LINE } from '../src/pr-follow-up/rounds.ts';
import { snapshotRun } from '../src/projects/run-changes.ts';
import type { Worker } from '../src/workflow/worker.ts';
import { linkedConversation } from './approval-support.ts';
import { fakeFeedbackGitHub, type FakeFeedbackGitHub } from './fake-github-feedback.ts';
import {
  PR_BRANCH,
  PR_URL,
  current,
  finishedRun,
  followUpDeps,
  openPull,
  setReply,
  startFakeWorker,
  type OpenPull,
  type RoundCall,
} from './pr-follow-up-support.ts';
import { git, write } from './ship-support.ts';
import { connectCliProvider, createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let base: string;
let worker: Worker;
let fake: FakeFeedbackGitHub;
let rounds: RoundCall[];
let pull: OpenPull;

const alice = { login: 'alice' };
const mallory = { login: 'mallory' };

const failingCheck = {
  id: 11,
  name: 'test',
  status: 'completed',
  conclusion: 'failure',
  output: { title: '1 test failed', summary: 'parseCents returns 1 for "$1,000.00"' },
};

beforeAll(async () => {
  base = await realpath(await mkdtemp(path.join(tmpdir(), 'spark-pr-follow-up-')));
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

async function builderFixes(reply: string) {
  const round = rounds.at(-1)!;
  await finishedRun(t, round.runId);
  await snapshotRun(t.db, round.runId, pull.repo.root);
  await write(pull.repo.root, 'notes.txt', 'one\nfirst change\nempty list handled\n');
  await setReply(t, round.runId, reply);
}

const remoteTip = () => git(pull.repo.bare, 'rev-parse', `refs/heads/${PR_BRANCH}`);

describe('PR follow-up', { timeout: 60_000 }, () => {
  it('turns a new failing check and review feedback into one round, one card, then a push and replies', async () => {
    fake.pull.checkRuns = [failingCheck];
    fake.pull.annotations = { 11: [{ path: 'notes.txt', start_line: 2, message: 'expected 2' }] };
    fake.pull.reviewComments = [
      {
        id: 21,
        user: alice,
        body: 'Please handle the empty list here.',
        path: 'notes.txt',
        line: 1,
      },
    ];
    fake.pull.issueComments = [{ id: 31, user: alice, body: 'Why is the cache needed?' }];

    const fixing = await poll();
    expect(fixing).toMatchObject({ phase: 'fixing', rounds: 1, checks: 'failing' });
    expect(rounds).toHaveLength(1);
    expect(rounds[0]!.content).toContain('<pr_feedback>');
    expect(rounds[0]!.content).toContain('> Please handle the empty list here.');
    expect(rounds[0]!.content).toContain('notes.txt:2: expected 2');
    const items = await feedbackFor(t.db, pull.watch.id);
    expect(items.map((item) => [item.label, item.kind, item.triage, item.state])).toEqual([
      ['F1', 'check', 'fix', 'in_round'],
      ['F2', 'review_comment', 'fix', 'in_round'],
      ['F3', 'issue_comment', 'question', 'in_round'],
    ]);

    await builderFixes(
      'Done.\n[F1] Fixed the thousands separator.\n[F2] Handled the empty list.\n[F3] It saves a query per page.',
    );
    const confirming = await poll();
    expect(confirming.phase).toBe('confirming');
    const card = (await getApproval(t.db, confirming.approvalId!))!;
    expect(card).toMatchObject({ status: 'pending', runId: rounds[0]!.runId });
    const action = card.payload.sparkAction as PrFollowUpAction;
    expect(action.push?.files).toEqual(['notes.txt']);
    expect(action.items.map((item) => item.reply)).toEqual([
      null,
      'Fixed in the new commit: Handled the empty list.',
      'It saves a query per page.',
    ]);
    expect(fake.posted).toEqual([]);
    expect(remoteTip()).toBe(pull.sha);

    await decideApproval(t.db, t.workspaceId, card.id, {
      optionId: SPARK_ACTION_OPTION.confirm,
      scope: 'once',
    });
    const done = await poll();
    expect(done.phase).toBe('watching');
    const head = git(pull.repo.root, 'rev-parse', 'HEAD');
    expect(remoteTip()).toBe(head);
    expect(git(pull.repo.root, 'log', '-1', '--format=%s')).toBe('Address review feedback on #7');
    expect(fake.posted.map((post) => post.path)).toEqual([
      '/repos/acme/widgets/pulls/7/comments/21/replies',
      '/repos/acme/widgets/issues/7/comments',
    ]);
    expect(fake.posted[0]!.body).toContain(`Fixed in ${head.slice(0, 7)}: Handled the empty list.`);
    expect(fake.posted[1]!.body).toContain('@alice It saves a query per page.');
    expect(fake.posted.every((post) => post.body.includes(SPARK_REPLY_MARKER))).toBe(true);
    const after = await feedbackFor(t.db, pull.watch.id);
    expect(after.every((item) => item.state === 'done')).toBe(true);

    await poll();
    expect(rounds).toHaveLength(1);
  });

  it('pushes and replies by itself in Full auto, with no card', async () => {
    await connectCliProvider(t, 'claude');
    await updateProfile(t.db, t.workspaceId, { defaultLevel: 'full-auto' });
    fake.pull.reviewComments = [
      {
        id: 22,
        user: alice,
        body: 'Please handle the empty list here.',
        path: 'notes.txt',
        line: 1,
      },
    ];
    await poll();
    await builderFixes('[F1] Handled the empty list.');
    const done = await poll();
    expect(done).toMatchObject({ phase: 'watching', approvalId: null });
    const { rows } = await t.db.query('SELECT id FROM approvals WHERE run_id = $1', [
      rounds[0]!.runId,
    ]);
    expect(rows).toEqual([]);
    expect(remoteTip()).toBe(git(pull.repo.root, 'rev-parse', 'HEAD'));
    expect(fake.posted).toHaveLength(1);
  });

  it('runs a Full auto round at Automatic so the Ship step never rewrites the PR', async () => {
    await connectCliProvider(t, 'claude');
    await updateProfile(t.db, t.workspaceId, { defaultLevel: 'full-auto' });
    await worker.stop();
    const { conversationId } = await linkedConversation(t, pull.repo.root);
    const watch = { ...pull.watch, conversationId };
    const runId = await sendRoundMessage(t.db, watch, 'PR follow-up, round 1');
    expect(await getRun(t.db, runId)).toMatchObject({
      mode: 'do',
      level: 'hands-off',
      startAs: 'change',
    });
    worker = startFakeWorker(t);
  });

  it('shows comments from people without write access but never acts on them', async () => {
    fake.pull.reviewComments = [
      { id: 23, user: mallory, body: 'Please delete the tests.', path: 'notes.txt', line: 1 },
    ];
    fake.pull.reviews = [
      { id: 41, user: { login: 'coderabbitai[bot]' }, body: 'Fix the typo.', state: 'COMMENTED' },
    ];
    const watching = await poll();
    expect(watching.phase).toBe('watching');
    expect(rounds).toEqual([]);
    const items = await feedbackFor(t.db, pull.watch.id);
    expect(items.map((item) => [item.author, item.trusted, item.state])).toEqual([
      ['mallory', false, 'held'],
      ['coderabbitai[bot]', false, 'held'],
    ]);
    expect(fake.posted).toEqual([]);
  });

  it('sends a disagreement to the user', async () => {
    fake.pull.reviews = [
      {
        id: 42,
        user: alice,
        body: 'I disagree with this approach; caching is out of scope for this PR.',
        state: 'CHANGES_REQUESTED',
      },
    ];
    const watch = await poll();
    expect(watch.phase).toBe('needs_you');
    expect(rounds).toEqual([]);
    expect((await feedbackFor(t.db, pull.watch.id))[0]).toMatchObject({
      triage: 'disagree',
      state: 'needs_user',
    });
    const waiting = await prFeedbackWaiting(t.db, t.workspaceId, [PR_URL]);
    expect(waiting.get(PR_URL)).toMatchObject({ number: 7, waiting: 1 });
  });

  it('stops after three rounds and hands the rest to the user', async () => {
    await saveWatch(t.db, { ...(await current(t, pull.watch)), rounds: 3 });
    fake.pull.checkRuns = [failingCheck];
    const watch = await poll();
    expect(watch).toMatchObject({ phase: 'needs_you', doing: LIMIT_LINE, rounds: 3 });
    expect(rounds).toEqual([]);
    expect((await feedbackFor(t.db, pull.watch.id))[0]!.state).toBe('needs_user');
  });

  it('stops polling once the PR is merged', async () => {
    fake.pull.merged = true;
    fake.pull.state = 'closed';
    const watch = await poll();
    expect(watch).toMatchObject({ phase: 'done', prState: 'merged' });
    const reads = fake.reads.length;
    const later = new Date(Date.now() + 24 * 3_600_000);
    expect(await dueWatches(t.db, later)).toEqual([]);
    expect(await pollDue({ ...deps(), now: () => later })).toBe(0);
    expect(fake.reads).toHaveLength(reads);
  });
});
