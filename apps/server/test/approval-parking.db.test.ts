import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CHECKPOINT_OPTION, STOPPED_BY_QUIT, type Approval } from '@spark-outpost/contracts';
import {
  ApprovalConflictError,
  decideApproval,
  getApproval,
} from '../src/persistence/approvals.ts';
import { getRun } from '../src/persistence/runs.ts';
import { ApprovalWaiters } from '../src/workflow/approval-waiters.ts';
import { userWaitParking } from '../src/workflow/background-parking.ts';
import { askCheckpoint, compactCard } from '../src/workflow/kept-record.ts';
import { ParkedTurns } from '../src/workflow/parked-turns.ts';
import { WAITING_OUTCOME_MESSAGE, recoverExpiredLeases } from '../src/workflow/recovery.ts';
import { stopRun } from '../src/workflow/stop-run.ts';
import { startWorker, type Worker } from '../src/workflow/worker.ts';
import { doRun, recordingAppend } from './approval-support.ts';
import { expireLeases } from './interruption-support.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';
import {
  auditOf,
  cardsOf,
  gitRepo,
  openChat,
  removeRepo,
  repliesOf,
  sendMessage,
} from './turn-support.ts';
import { connectAgents, fakeAgents } from './turn-worker.ts';

let t: TestDb;
let root: string;
let parked: ParkedTurns;
let worker: Worker | null = null;

function begin(leaseSeconds = 30) {
  parked = new ParkedTurns();
  worker = startWorker({
    db: t.db,
    providers: fakeAgents(),
    leaseSeconds,
    concurrency: 1,
    parked,
    pollMs: 20,
    cancelPollMs: 20,
    approvalPollMs: 20,
  });
}

beforeEach(async () => {
  t = await createTestDb();
  root = await gitRepo();
  await connectAgents(t);
});

afterEach(async () => {
  await worker?.stop();
  worker = null;
  await t.cleanup();
  await removeRepo(root);
});

async function askingRun() {
  const conversationId = await openChat(t, { root });
  const runId = await sendMessage(t, conversationId, 'Run it #command', { permission: 'do' });
  const card = await eventually(async () => {
    const pending = (await cardsOf(t, conversationId)).find((each) => each.status === 'pending');
    return pending ?? null;
  }, 20_000);
  await eventually(async () => (await getRun(t.db, runId))?.status === 'awaiting_approval');
  expect(parked.size).toBe(1);
  return { conversationId, runId, card };
}

async function chatRun(text: string) {
  const conversationId = await openChat(t);
  return sendMessage(t, conversationId, text);
}

async function settled(runId: string) {
  return eventually(async () => {
    const run = await getRun(t.db, runId);
    return run?.finishedAt ? run : null;
  }, 20_000);
}

const allow = (card: Approval) => decideApproval(t.db, t.workspaceId, card.id, allowOnce(card));

function allowOnce(card: Approval) {
  const option = card.options.find((each) => each.kind === 'allow_once')!;
  return { optionId: option.optionId, scope: 'once' as const };
}

async function permissionExchange(runId: string) {
  const entries = (await auditOf(t, runId)).filter(
    (entry) => entry.method === 'session/request_permission',
  );
  return entries.map((entry) => ({ direction: entry.direction, kind: entry.kind }));
}

const ANSWERED_ONCE = [
  { direction: 'from_agent', kind: 'request' },
  { direction: 'to_agent', kind: 'response' },
];

const cardOf = (card: Approval) => getApproval(t.db, card.id);

describe('a turn waiting on your approval card', { timeout: 60_000 }, () => {
  it('frees its worker slot, then resumes and answers the agent once when you allow', async () => {
    begin();
    const waiting = await askingRun();
    expect((await getRun(t.db, waiting.runId))?.status).toBe('awaiting_approval');

    const other = await chatRun('Hi');
    expect((await settled(other)).status).toBe('succeeded');
    expect((await getRun(t.db, waiting.runId))?.status).toBe('awaiting_approval');

    const answers = await Promise.allSettled([allow(waiting.card), allow(waiting.card)]);
    expect(answers.map((answer) => answer.status).toSorted()).toEqual(['fulfilled', 'rejected']);
    const refused = answers.find((answer) => answer.status === 'rejected');
    expect(refused?.reason).toBeInstanceOf(ApprovalConflictError);

    expect((await settled(waiting.runId)).status).toBe('succeeded');
    expect(await repliesOf(t, waiting.runId)).toEqual(['permission=yes']);
    expect(await permissionExchange(waiting.runId)).toEqual(ANSWERED_ONCE);
    expect(await cardOf(waiting.card)).toMatchObject({ status: 'allowed', decidedBy: 'user' });
    expect(parked.size).toBe(0);
  });

  it('takes its slot back on resume, so no new turn starts until one frees', async () => {
    begin();
    const waiting = await askingRun();
    const busy = await chatRun('Keep going #slow');
    await eventually(async () => (await getRun(t.db, busy))?.status === 'running');

    await allow(waiting.card);
    expect((await settled(waiting.runId)).status).toBe('succeeded');
    const later = await chatRun('Hi');
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect((await getRun(t.db, later))?.status).toBe('queued');

    await stopRun(t.db, busy);
    expect((await settled(busy)).status).toBe('cancelled');
    expect((await settled(later)).status).toBe('succeeded');
  });

  it('stops while parked, cancels the card, and refuses an answer that arrives after', async () => {
    begin();
    const waiting = await askingRun();

    await stopRun(t.db, waiting.runId);
    expect((await settled(waiting.runId)).status).toBe('cancelled');
    expect(await cardOf(waiting.card)).toMatchObject({ status: 'cancelled', decidedBy: 'stop' });
    await expect(allow(waiting.card)).rejects.toBeInstanceOf(ApprovalConflictError);
    expect(await permissionExchange(waiting.runId)).toEqual(ANSWERED_ONCE);
    expect(parked.size).toBe(0);

    const other = await chatRun('Hi');
    expect((await settled(other)).status).toBe('succeeded');
  });

  it('ends at once on Quit, as a turn waiting on background work does', async () => {
    begin();
    const waiting = await askingRun();

    const started = Date.now();
    await worker?.stop();
    worker = null;

    expect(Date.now() - started).toBeLessThan(10_000);
    expect(await getRun(t.db, waiting.runId)).toMatchObject({
      status: 'cancelled',
      error: STOPPED_BY_QUIT,
    });
    expect(await cardOf(waiting.card)).toMatchObject({ status: 'cancelled', decidedBy: 'stop' });
  });

  it('is recovered as interrupted while waiting when Spark died, and ignores the dead turn after', async () => {
    begin(3);
    const waiting = await askingRun();

    await expireLeases(t, waiting.runId);
    expect(await recoverExpiredLeases(t.db)).toBe(1);
    expect(await getRun(t.db, waiting.runId)).toMatchObject({
      status: 'outcome_unknown',
      error: WAITING_OUTCOME_MESSAGE,
    });
    expect(await cardOf(waiting.card)).toMatchObject({
      status: 'expired',
      decidedBy: 'recovery',
    });
    await expect(allow(waiting.card)).rejects.toBeInstanceOf(ApprovalConflictError);

    await eventually(async () => parked.size === 0, 20_000);
    expect(await getRun(t.db, waiting.runId)).toMatchObject({
      status: 'outcome_unknown',
      error: WAITING_OUTCOME_MESSAGE,
    });
    const other = await chatRun('Hi');
    expect((await settled(other)).status).toBe('succeeded');
  });
});

describe('a checkpoint card', () => {
  function ask(runId: string, turns: ParkedTurns) {
    const controller = new AbortController();
    const answer = askCheckpoint(
      {
        db: t.db,
        runId,
        append: recordingAppend().append,
        waiters: new ApprovalWaiters(),
        signal: controller.signal,
        timeoutMs: 10_000,
        pollMs: 20,
        park: userWaitParking(turns, runId, () => controller.abort()),
      },
      compactCard('This chat is almost full.', 90),
      1,
    );
    return answer;
  }

  async function pendingCard(runId: string): Promise<Approval> {
    return eventually(async () => {
      const { rows } = await t.db.query<{ id: string }>(
        `SELECT id FROM approvals WHERE run_id = $1 AND status = 'pending'`,
        [runId],
      );
      return rows[0] ? getApproval(t.db, rows[0].id) : null;
    });
  }

  it('frees the slot while it waits and takes it back when answered', async () => {
    const { runId } = await doRun(t, root);
    const turns = new ParkedTurns();
    const answer = ask(runId, turns);
    const card = await pendingCard(runId);
    expect(turns.size).toBe(1);

    await decideApproval(t.db, t.workspaceId, card.id, {
      optionId: CHECKPOINT_OPTION.compactNow,
      scope: 'once',
    });
    expect(await answer).toMatchObject({
      type: 'answered',
      optionId: CHECKPOINT_OPTION.compactNow,
    });
    expect(turns.size).toBe(0);
  });

  it('stops at once on Quit and cancels the card', async () => {
    const { runId } = await doRun(t, root);
    const turns = new ParkedTurns();
    const answer = ask(runId, turns);
    const card = await pendingCard(runId);

    expect(turns.quit()).toBe(1);
    expect(await answer).toEqual({ type: 'stopped' });
    expect(turns.size).toBe(0);
    expect(await getApproval(t.db, card.id)).toMatchObject({ status: 'cancelled' });
  });
});
