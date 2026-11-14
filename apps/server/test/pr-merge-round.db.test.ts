import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { roundOutcomeLine } from '@spark-outpost/contracts';
import { updateProfile } from '../src/persistence/setup.ts';
import { pollWatch } from '../src/pr-follow-up/poller.ts';
import { watchView } from '../src/pr-follow-up/view.ts';
import type { Worker } from '../src/workflow/worker.ts';
import { fakeFeedbackGitHub, type FakeFeedbackGitHub } from './fake-github-feedback.ts';
import {
  current,
  finishedRun,
  followUpDeps,
  openPull,
  PR_BRANCH,
  setReply,
  startFakeWorker,
  type OpenPull,
  type RoundCall,
} from './pr-follow-up-support.ts';
import { git, write } from './ship-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let base: string;
let worker: Worker;
let fake: FakeFeedbackGitHub;
let rounds: RoundCall[];
let pull: OpenPull;

beforeAll(async () => {
  base = await realpath(await mkdtemp(path.join(tmpdir(), 'spark-pr-merge-')));
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

beforeEach(async (context) => {
  t = await createTestDb();
  worker = startFakeWorker(t);
  pull = await openPull(t, base, context.task.id);
  fake = fakeFeedbackGitHub({ sha: pull.sha });
  fake.pull.baseRef = 'main';
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

describe('a branch that falls behind or into conflict', { timeout: 60_000 }, () => {
  it('starts one round to merge the base, with nothing else new', async () => {
    fake.pull.mergeableState = 'behind';
    const watch = await poll();
    expect(watch.phase).toBe('fixing');
    expect(watch.mergeRoundFor).toBe(`${pull.sha}:main`);
    expect(rounds).toHaveLength(1);
    expect(rounds[0]!.content).toContain('PR #7 is behind main');
    expect(rounds[0]!.content).toContain('`git merge origin/main`');
    expect(rounds[0]!.content).toContain('only update the branch');
    expect(rounds[0]!.content).not.toContain('</pr_feedback>');
    expect(watch.doing).toContain('Updating the branch from its base (round 1).');
  });

  it('does not start a second round for the same head and base, across duplicates and a restart', async () => {
    fake.pull.mergeableState = 'dirty';
    await poll();
    const settled = await roundEnds('The merge has conflicts I cannot resolve. Needs you: x.ts');
    expect(settled.quietHead).toBe(pull.sha);
    fake.pull.mergeableState = 'behind';
    await poll();
    const restarted = await current(t, pull.watch);
    expect(restarted.mergeRoundFor).toBe(`${pull.sha}:main`);
    await pollWatch(deps(), restarted);
    expect(rounds).toHaveLength(1);
  });

  it('starts again for a new head that is still behind', async () => {
    fake.pull.mergeableState = 'behind';
    await poll();
    await roundEnds('Nothing to merge.');
    await write(pull.repo.root, 'notes.txt', 'one\nsecond change\n');
    git(pull.repo.root, 'commit', '-qam', 'Another change');
    git(pull.repo.root, 'push', '-q', 'origin', PR_BRANCH);
    fake.pull.sha = git(pull.repo.root, 'rev-parse', 'HEAD');
    const again = await poll();
    expect(again.mergeRoundFor).toBe(`${fake.pull.sha}:main`);
    expect(rounds).toHaveLength(2);
  });

  it('starts nothing while GitHub is still computing, or while follow-up asks first', async () => {
    fake.pull.mergeableState = 'unknown';
    await poll();
    expect(rounds).toHaveLength(0);
    await updateProfile(t.db, t.workspaceId, { prFollowUpAsk: true });
    fake.pull.mergeableState = 'behind';
    const asked = await poll();
    expect(rounds).toHaveLength(0);
    expect(asked.mergeRoundFor).toBeNull();
  });

  it('starts a merge round after an earlier review round on the same head', async () => {
    fake.pull.reviewComments = [
      { id: 21, user: { login: 'alice' }, body: 'Handle the empty list.', path: 'a.ts', line: 1 },
    ];
    await poll();
    await roundEnds('[F1] pushed back: The caller already rejects an empty list.');
    expect(rounds).toHaveLength(1);
    fake.pull.mergeableState = 'behind';
    const merged = await poll();
    expect(merged.phase).toBe('fixing');
    expect(rounds).toHaveLength(2);
  });
});

describe('round outcomes for attribution', { timeout: 60_000 }, () => {
  it('records what a round did, once, through a repeated poll', async () => {
    fake.pull.reviewComments = [
      { id: 21, user: { login: 'alice' }, body: 'Handle the empty list.', path: 'a.ts', line: 1 },
    ];
    await poll();
    const settled = await roundEnds('[F1] pushed back: The caller already rejects an empty list.');
    await poll();
    const view = await watchView(t.db, await current(t, pull.watch));
    expect(view.roundOutcomes).toHaveLength(1);
    const [outcome] = view.roundOutcomes!;
    expect(outcome).toMatchObject({
      runId: rounds[0]!.runId,
      round: 1,
      ended: 'settled',
      pushed: false,
      replied: 1,
    });
    expect(roundOutcomeLine(outcome!)).toBe('Follow-up replied to 1 comment');
    expect(settled.quietHead).toBeNull();
  });

  it('records a stopped round', async () => {
    fake.pull.reviewComments = [
      { id: 21, user: { login: 'alice' }, body: 'Handle the empty list.', path: 'a.ts', line: 1 },
    ];
    await poll();
    await finishedRun(t, rounds[0]!.runId);
    await t.db.query("UPDATE runs SET status = 'cancelled' WHERE id = $1", [rounds[0]!.runId]);
    const stopped = await poll();
    expect(stopped.doing).toContain('was stopped');
    const view = await watchView(t.db, await current(t, pull.watch));
    expect(view.roundOutcomes?.map((entry) => entry.ended)).toEqual(['stopped']);
  });
});
