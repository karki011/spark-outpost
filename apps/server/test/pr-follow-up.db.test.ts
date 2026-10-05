import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SPARK_ACTION_OPTION, type PrFollowUpAction } from '@spark-outpost/contracts';
import { decideApproval, getApproval } from '../src/persistence/approvals.ts';
import { feedbackFor, prFeedbackWaiting, saveWatch } from '../src/persistence/pr-watches.ts';
import { duePulls } from '../src/persistence/tracked-pulls.ts';
import { getRun } from '../src/persistence/runs.ts';
import { updateProfile } from '../src/persistence/setup.ts';
import { sendRoundMessage } from '../src/pr-follow-up/deps.ts';
import { SPARK_REPLY_MARKER } from '../src/pr-follow-up/gather.ts';
import { pollDue, pollWatch } from '../src/pr-follow-up/poller.ts';
import { PR_REPLY_METHOD } from '../src/pr-follow-up/round.ts';
import { CHAT_BUSY_LINE, LIMIT_LINE } from '../src/pr-follow-up/rounds.ts';
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

async function builderFixes(reply: string, publish: 'pushes' | 'commits' | 'leaves' = 'leaves') {
  const round = rounds.at(-1)!;
  await finishedRun(t, round.runId);
  await snapshotRun(t.db, round.runId, pull.repo.root);
  await write(pull.repo.root, 'notes.txt', 'one\nfirst change\nempty list handled\n');
  if (publish !== 'leaves') git(pull.repo.root, 'commit', '-qam', 'Handle the empty list');
  if (publish === 'pushes') git(pull.repo.root, 'push', '-q', 'origin', PR_BRANCH);
  await setReply(t, round.runId, reply);
}

async function replyAudits(runId: string) {
  const { rows } = await t.db.query<{ payload: Record<string, unknown> }>(
    `SELECT payload FROM run_protocol_log WHERE run_id = $1 AND method = $2 ORDER BY seq`,
    [runId, PR_REPLY_METHOD],
  );
  return rows.map((row) => row.payload);
}

const emptyListComment = {
  id: 22,
  user: { login: 'alice' },
  body: 'Please handle the empty list here.',
  path: 'notes.txt',
  line: 1,
};

const remoteTip = () => git(pull.repo.bare, 'rev-parse', `refs/heads/${PR_BRANCH}`);

describe('PR follow-up', { timeout: 60_000 }, () => {
  it('with ask first on, turns a failing check and review feedback into one round, one card, then a push and replies', async () => {
    await updateProfile(t.db, t.workspaceId, { prFollowUpAsk: true });
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
    expect(rounds[0]!.content).toMatch(
      /^Spark: CI failed on PR #7 \(test\) and 2 review items arrived on PR #7, so I asked this chat to look\./,
    );
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

  it('replies by itself once the agent pushed the fix, at Automatic, with no card', async () => {
    fake.pull.reviewComments = [emptyListComment];
    await poll();
    expect(rounds[0]!.content).toContain('Judge each item on its merits');
    await builderFixes('[F1] fixed: Handled the empty list.', 'pushes');
    const done = await poll();
    expect(done).toMatchObject({ phase: 'watching', approvalId: null });
    const { rows } = await t.db.query('SELECT id FROM approvals WHERE run_id = $1', [
      rounds[0]!.runId,
    ]);
    expect(rows).toEqual([]);
    const head = git(pull.repo.root, 'rev-parse', 'HEAD');
    expect(remoteTip()).toBe(head);
    expect(fake.posted).toHaveLength(1);
    expect(fake.posted[0]!.body).toContain(`Fixed in ${head.slice(0, 7)}: Handled the empty list.`);
    expect(await replyAudits(rounds[0]!.runId)).toEqual([
      expect.objectContaining({ item: 'F1', to: 'alice', number: 7 }),
    ]);
  });

  it('posts a reasoned push-back, changes no code and does not call it fixed', async () => {
    fake.pull.reviewComments = [emptyListComment];
    await poll();
    await finishedRun(t, rounds[0]!.runId);
    await setReply(
      t,
      rounds[0]!.runId,
      '[F1] pushed back: The caller already rejects an empty list, see parse.ts.',
    );
    const done = await poll();
    expect(done.phase).toBe('watching');
    expect(remoteTip()).toBe(pull.sha);
    expect(fake.posted).toHaveLength(1);
    expect(fake.posted[0]!.path).toBe('/repos/acme/widgets/pulls/7/comments/22/replies');
    expect(fake.posted[0]!.body).toContain(
      'Not changed: The caller already rejects an empty list, see parse.ts.',
    );
    expect(fake.posted[0]!.body).not.toContain('Fixed in');
    const audits = await replyAudits(rounds[0]!.runId);
    expect(audits[0]!.text).toContain('Not changed: The caller already rejects');
  });

  it('hands an item the agent left for the user to the user, with no reply', async () => {
    fake.pull.reviewComments = [emptyListComment];
    await poll();
    await finishedRun(t, rounds[0]!.runId);
    await setReply(t, rounds[0]!.runId, '[F1] left for you: This changes what the task covers.');
    const done = await poll();
    expect(done.phase).toBe('needs_you');
    expect(fake.posted).toEqual([]);
    expect((await feedbackFor(t.db, pull.watch.id))[0]!.state).toBe('needs_user');
  });

  it('never says fixed when the fix was committed but not pushed', async () => {
    fake.pull.reviewComments = [emptyListComment];
    await poll();
    await builderFixes('[F1] fixed: Handled the empty list.', 'commits');
    const done = await poll();
    expect(done.phase).toBe('needs_you');
    expect(done.doing).toContain('was not pushed');
    expect(fake.posted).toEqual([]);
    expect(remoteTip()).toBe(pull.sha);
  });

  it('redacts a secret the agent put in a reply before it is posted or audited', async () => {
    const leaked = `ghp_${'a1B2c3D4e5'.repeat(4)}`;
    fake.pull.issueComments = [{ id: 33, user: alice, body: 'Why is the cache needed?' }];
    await poll();
    await finishedRun(t, rounds[0]!.runId);
    await setReply(t, rounds[0]!.runId, `[F1] answer: It reuses the token ${leaked} per page.`);
    await poll();
    expect(fake.posted).toHaveLength(1);
    expect(fake.posted[0]!.body).not.toContain(leaked);
    expect(JSON.stringify(await replyAudits(rounds[0]!.runId))).not.toContain(leaked);
  });

  it('waits for a busy chat, then starts one round for everything that arrived meanwhile', async () => {
    const turn = randomUUID();
    const message = randomUUID();
    await t.db.query(
      `INSERT INTO messages (id, conversation_id, role, content) VALUES ($1, $2, 'user', 'Go on')`,
      [message, pull.conversationId],
    );
    await t.db.query(
      `INSERT INTO runs (id, conversation_id, user_message_id, provider, status)
       VALUES ($1, $2, $3, 'fake', 'running')`,
      [turn, pull.conversationId, message],
    );
    fake.pull.reviewComments = [emptyListComment];
    const waiting = await poll();
    expect(waiting).toMatchObject({ phase: 'watching', doing: CHAT_BUSY_LINE, rounds: 0 });
    fake.pull.issueComments = [{ id: 34, user: alice, body: 'Why is the cache needed?' }];
    expect(await poll()).toMatchObject({ phase: 'watching', rounds: 0 });
    expect(rounds).toEqual([]);

    await t.db.query(`UPDATE runs SET status = 'succeeded', finished_at = now() WHERE id = $1`, [
      turn,
    ]);
    expect(await poll()).toMatchObject({ phase: 'fixing', rounds: 1 });
    expect(rounds).toHaveLength(1);
    expect(rounds[0]!.content).toContain('Please handle the empty list here.');
    expect(rounds[0]!.content).toContain('Why is the cache needed?');
  });

  it('stops when CI fails the same way after the fix, and tries again when it fails differently', async () => {
    fake.pull.checkRuns = [failingCheck];
    await poll();
    await builderFixes('[F1] fixed: The thousands separator.', 'pushes');
    await poll();
    fake.pull.sha = git(pull.repo.root, 'rev-parse', 'HEAD');
    const same = await poll();
    expect(same.phase).toBe('needs_you');
    expect(same.doing).toContain('CI still fails the same way after the fix (test)');
    expect(rounds).toHaveLength(1);

    await write(pull.repo.root, 'notes.txt', 'one\nfirst change\nsecond try\n');
    git(pull.repo.root, 'commit', '-qam', 'Second try');
    git(pull.repo.root, 'push', '-q', 'origin', PR_BRANCH);
    fake.pull.sha = git(pull.repo.root, 'rev-parse', 'HEAD');
    fake.pull.checkRuns = [
      { ...failingCheck, output: { title: '1 test failed', summary: 'a different failure' } },
    ];
    expect(await poll()).toMatchObject({ phase: 'fixing', rounds: 2 });
  });

  it('hands a request the reviewer repeats after a push-back to the user instead of arguing', async () => {
    fake.pull.reviewComments = [emptyListComment];
    await poll();
    await finishedRun(t, rounds[0]!.runId);
    await setReply(t, rounds[0]!.runId, '[F1] pushed back: The caller rejects an empty list.');
    await poll();
    expect(fake.posted).toHaveLength(1);
    fake.pull.reviewComments = [
      emptyListComment,
      { ...emptyListComment, id: 24, body: 'Please handle the empty list here. I asked before.' },
    ];
    const again = await poll();
    expect(again.phase).toBe('needs_you');
    expect(again.doing).toContain('already pushed back on');
    expect(rounds).toHaveLength(1);
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

  it('waits for every check to finish before it calls them failing and starts a round', async () => {
    fake.pull.checkRuns = [
      failingCheck,
      { id: 12, name: 'build', status: 'in_progress', conclusion: null },
    ];
    expect(await poll()).toMatchObject({ phase: 'watching', checks: 'pending', rounds: 0 });
    expect(rounds).toEqual([]);

    fake.pull.checkRuns = [
      failingCheck,
      { id: 12, name: 'build', status: 'completed', conclusion: 'success' },
    ];
    expect(await poll()).toMatchObject({
      phase: 'fixing',
      checks: 'failing',
      failingChecks: [{ name: 'test', url: null }],
      rounds: 1,
    });
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
    expect(await duePulls(t.db, later)).toEqual([]);
    expect(await pollDue({ ...deps(), now: () => later })).toBe(0);
    expect(fake.reads).toHaveLength(reads);
  });
});
