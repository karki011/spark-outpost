import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getRun, requestCancel } from '../src/persistence/runs.ts';
import { loadRunInput } from '../src/workflow/run-input.ts';
import type { Worker } from '../src/workflow/worker.ts';
import {
  PULL_URL,
  checkoutRefs,
  repoWithPull,
  worktreeList,
  type PullRepo,
} from './crew-pr-checkout-support.ts';
import {
  newSpark,
  recordOf,
  saveFlow,
  statesOf,
  step,
  useWorkflowsDir,
} from './crew-workflow-support.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';
import { openChat, repliesOf, sendMessage } from './turn-support.ts';
import { connectAgents, startTurnWorker } from './turn-worker.ts';

let t: TestDb;
let base: string;
let repo: PullRepo;
let harness: Worker | null = null;
let dropWorkflows: () => Promise<void>;
let repos = 0;

const exists = (target: string) =>
  access(target).then(
    () => true,
    () => false,
  );

beforeAll(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'spark-pr-checkout-turn-'));
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

beforeEach(async () => {
  t = await createTestDb();
  repos += 1;
  repo = await repoWithPull(base, `widgets-${repos}`);
  dropWorkflows = await useWorkflowsDir();
  await connectAgents(t);
  harness = startTurnWorker(t);
});

afterEach(async () => {
  await harness?.stop();
  harness = null;
  await t.cleanup();
  await dropWorkflows();
});

async function start(text: string) {
  const conversationId = await openChat(t, { root: repo.root, level: 'hands-off' });
  return sendMessage(t, conversationId, text);
}

async function finished(runId: string) {
  await eventually(async () => ((await getRun(t.db, runId))?.finishedAt ? true : null), 60_000);
  return recordOf(t, runId);
}

async function runningStep(runId: string, id: string): Promise<string> {
  return eventually(async () => {
    const record = await recordOf(t, runId);
    const found = record?.steps.find((entry) => entry.stepId === id);
    return found?.state === 'running' && found.runId ? found.runId : null;
  }, 60_000);
}

async function promptOf(runId: string): Promise<string> {
  const { rows } = await t.db.query<{ prompt: string }>('SELECT prompt FROM runs WHERE id = $1', [
    runId,
  ]);
  return rows[0]?.prompt ?? '';
}

function expectNoCheckout() {
  expect(
    worktreeList(repo.root)
      .split('\n')
      .filter((line) => line.startsWith('worktree ')),
  ).toEqual([`worktree ${repo.root}`]);
  expect(checkoutRefs(repo.root)).toBe('');
}

describe('a workflow run named for another pull request in the chat’s repository', () => {
  it('tells its steps about the checkout and removes it when the run finishes', async () => {
    const pip = await newSpark(t, 'Pip');
    await saveFlow(t, 'check', [step('look', pip.id)]);

    const runId = await start(`@check look at ${PULL_URL}`);
    const record = await finished(runId);
    const stepRun = record!.steps[0]!.runId!;

    expect(record).toMatchObject({ status: 'succeeded', pull: 'acme/widgets#7' });
    expect(await promptOf(stepRun)).toContain(
      `temporary checkout of pull request acme/widgets#7 at its head (${repo.pullHead.slice(0, 12)}`,
    );
    const [note] = await repliesOf(t, runId);
    expect(note).toContain(
      'The steps ran on a temporary checkout of pull request acme/widgets#7 at its head',
    );
    expectNoCheckout();
  }, 90_000);

  it('removes the checkout when a step fails', async () => {
    const pip = await newSpark(t, 'Pip');
    await saveFlow(t, 'strict', [step('gate', pip.id, { prompt: '#crash' })]);

    const record = await finished(await start(`@strict look at ${PULL_URL}`));

    expect(record?.status).toBe('failed');
    expectNoCheckout();
  }, 90_000);

  it('runs a step in the checkout and removes it when the turn is stopped', async () => {
    const pip = await newSpark(t, 'Pip');
    await saveFlow(t, 'slow', [step('slow', pip.id, { prompt: 'Take your time. #slow' })]);

    const runId = await start(`@slow look at ${PULL_URL}`);
    const stepRun = await runningStep(runId, 'slow');
    const roots = (await loadRunInput(t.db, stepRun)).projectRoots;
    expect(await exists(roots[0]!)).toBe(true);
    await requestCancel(t.db, runId);
    const record = await finished(runId);

    expect(roots).toEqual([path.join(repo.root, '.spark', 'worktrees', `pr-${record!.id}`)]);
    expect(await exists(roots[0]!)).toBe(false);
    expect(record?.status).toBe('cancelled');
    expect(statesOf(record)).toEqual({ slow: 'cancelled' });
    expectNoCheckout();
  }, 90_000);

  it('keeps its steps on the chat’s folder for a pull request in another repository', async () => {
    const pip = await newSpark(t, 'Pip');
    await saveFlow(t, 'check', [step('look', pip.id)]);

    const runId = await start('@check look at https://github.com/someone/else/pull/3');
    const record = await finished(runId);

    const stepRun = record!.steps[0]!.runId!;
    expect((await loadRunInput(t.db, stepRun)).projectRoots).toEqual([repo.root]);
    expect(await promptOf(stepRun)).toContain(
      'pull request someone/else#3, which is not in a repository linked to this chat',
    );
    const [note] = await repliesOf(t, runId);
    expect(note).toContain(
      'Pull request someone/else#3 is not in a repository linked to this chat, so the steps read it from GitHub',
    );
    expectNoCheckout();
  }, 90_000);
});
