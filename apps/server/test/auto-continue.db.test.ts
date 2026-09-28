import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CHECKPOINT_OPTION, type Approval } from '@spark-outpost/contracts';
import {
  decideApproval,
  getApproval,
  holdApproval,
  insertApproval,
  settleIfDue,
} from '../src/persistence/approvals.ts';
import { getConversationDetail } from '../src/persistence/conversations.ts';
import { autoContinueSeconds, updateProfile } from '../src/persistence/setup.ts';
import { askCheckpoint, retryCard, type CheckpointCard } from '../src/orchestration/checkpoint.ts';
import { ApprovalWaiters } from '../src/workflow/approval-waiters.ts';
import { doRun, recordingAppend } from './approval-support.ts';
import {
  TRIVIAL,
  answerEverything,
  connectProviders,
  driveToEnd,
  gitRepo,
  jevFetch,
  removeRepo,
  startOrchestrator,
  startScenario,
  type Answerer,
  type Harness,
} from './orchestration-support.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

let t: TestDb;
let root: string;

beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'spark-auto-continue-')));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

beforeEach(async () => {
  t = await createTestDb();
});

afterEach(async () => {
  await t.cleanup();
});

function jevRetry(): CheckpointCard {
  return retryCard(null, null, 'Stopped after 2 retries.');
}

async function pendingCheckpoint(runId: string, autoContinueMs: number | null) {
  const card = jevRetry();
  return insertApproval(t.db, {
    runId,
    toolCallId: `checkpoint:retry:${Math.random()}`,
    rpcId: null,
    kind: card.kind,
    title: card.title,
    payload: {
      command: null,
      cwd: null,
      paths: [],
      diffs: [],
      truncated: false,
      checkpoint: card.payload,
    },
    options: card.options,
    reason: card.payload.reason,
    autoContinueMs,
  });
}

function ask(runId: string, card: CheckpointCard, autoContinueMs: number | null) {
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
      autoContinueMs,
    },
    card,
    1,
  );
  return { answer, stop: () => controller.abort() };
}

async function checkpointOf(runId: string): Promise<Approval> {
  return eventually(async () => {
    const { rows } = await t.db.query<{ id: string }>(
      `SELECT id FROM approvals WHERE run_id = $1 AND kind = 'retry'`,
      [runId],
    );
    return rows[0] ? getApproval(t.db, rows[0].id) : null;
  });
}

describe('auto-continue on Jev questions', () => {
  it('takes the safe default once the deadline passes, decided by auto', async () => {
    const { runId } = await doRun(t, root);
    const { answer } = ask(runId, jevRetry(), 200);
    expect(await answer).toEqual({
      type: 'answered',
      optionId: CHECKPOINT_OPTION.stopReport,
      note: null,
    });
    const settled = await checkpointOf(runId);
    expect(settled).toMatchObject({
      status: 'denied',
      decidedBy: 'auto',
      decisionOptionId: CHECKPOINT_OPTION.stopReport,
    });
    expect(Date.parse(settled.autoContinueAt!) - Date.parse(settled.createdAt)).toBe(200);
  });

  it('never sets a deadline on a card without a safe default, or when turned off', async () => {
    const { runId } = await doRun(t, root);
    const retry = retryCard(null, null, 'Stopped after 2 retries.');
    const plain = { ...retry, payload: { ...retry.payload, autoOption: null } };
    const first = ask(runId, plain, 200);
    const pending = await checkpointOf(runId);
    expect(pending.autoContinueAt).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect((await getApproval(t.db, pending.id))?.status).toBe('pending');
    first.stop();
    await first.answer;
    const off = await pendingCheckpoint(runId, null);
    expect(off.autoContinueAt).toBeNull();
    expect(await settleIfDue(t.db, off.id, CHECKPOINT_OPTION.stopReport)).toBeNull();
  });

  it('resolves only items that are still pending and due', async () => {
    const { runId } = await doRun(t, root);
    const later = await pendingCheckpoint(runId, 60_000);
    expect(await settleIfDue(t.db, later.id, CHECKPOINT_OPTION.stopReport)).toBeNull();
    const due = await pendingCheckpoint(runId, 0);
    await decideApproval(t.db, t.workspaceId, due.id, {
      optionId: CHECKPOINT_OPTION.retry,
      scope: 'once',
    });
    expect(await settleIfDue(t.db, due.id, CHECKPOINT_OPTION.stopReport)).toBeNull();
    expect(await getApproval(t.db, due.id)).toMatchObject({
      status: 'allowed',
      decidedBy: 'user',
      decisionOptionId: CHECKPOINT_OPTION.retry,
    });
  });

  it('lets exactly one of a user decision and the timeout win a race', async () => {
    const { runId } = await doRun(t, root);
    for (let round = 0; round < 5; round += 1) {
      const due = await pendingCheckpoint(runId, 0);
      const [user, auto] = await Promise.allSettled([
        decideApproval(t.db, t.workspaceId, due.id, {
          optionId: CHECKPOINT_OPTION.retry,
          scope: 'once',
        }),
        settleIfDue(t.db, due.id, CHECKPOINT_OPTION.stopReport),
      ]);
      const userWon = user.status === 'fulfilled';
      const autoWon = auto.status === 'fulfilled' && auto.value !== null;
      expect(userWon !== autoWon).toBe(true);
      const settled = await getApproval(t.db, due.id);
      expect(settled?.decidedBy).toBe(userWon ? 'user' : 'auto');
    }
  });

  it('holds the countdown when you start answering, then waits for you', async () => {
    const { runId } = await doRun(t, root);
    const { answer } = ask(runId, jevRetry(), 300);
    const pending = await checkpointOf(runId);
    const held = await holdApproval(t.db, t.workspaceId, pending.id);
    expect(held).toMatchObject({ status: 'pending', autoContinueAt: null });
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect((await getApproval(t.db, pending.id))?.status).toBe('pending');
    await decideApproval(t.db, t.workspaceId, pending.id, {
      optionId: CHECKPOINT_OPTION.retry,
      scope: 'once',
    });
    expect(await answer).toMatchObject({ type: 'answered', optionId: CHECKPOINT_OPTION.retry });
    expect((await getApproval(t.db, pending.id))?.decidedBy).toBe('user');
  });

  it('defaults to 10 seconds and can be turned off in settings', async () => {
    expect(await autoContinueSeconds(t.db, t.workspaceId)).toBe(10);
    await updateProfile(t.db, t.workspaceId, { autoContinueSeconds: 30 });
    expect(await autoContinueSeconds(t.db, t.workspaceId)).toBe(30);
    await updateProfile(t.db, t.workspaceId, { autoContinueSeconds: null });
    expect(await autoContinueSeconds(t.db, t.workspaceId)).toBeNull();
    await updateProfile(t.db, t.workspaceId, { displayName: 'Hari' });
    expect(await autoContinueSeconds(t.db, t.workspaceId)).toBeNull();
  });
});

describe('auto-continue in a crew run', () => {
  let repo: string;
  let harness: Harness | null = null;

  afterEach(async () => {
    await harness?.stop();
    harness = null;
    await removeRepo(repo);
  });

  it('lets the rules decide an unanswered clarify, but waits for edits and keep', async () => {
    repo = await gitRepo();
    await connectProviders(t);
    await updateProfile(t.db, t.workspaceId, { autoContinueSeconds: 1 });
    const unsure = { ...TRIVIAL, text: 'Make the reports better', vague: 0.95 };
    harness = startOrchestrator(t, jevFetch({ calls: [], scenario: unsure }));
    const { conversationId, runId } = await startScenario(t, repo, unsure, 'balanced');
    const answers: Answerer = (approval) =>
      approval.kind === 'clarify' ? null : answerEverything(approval);
    const { asked, orchestration } = await driveToEnd(t, conversationId, runId, answers);
    expect(asked.map((approval) => approval.kind)).toEqual([]);
    expect(orchestration).toMatchObject({ status: 'succeeded' });
    expect(orchestration.checkpoints[0]).toMatchObject({
      kind: 'clarify',
      decidedBy: 'auto',
      decisionOptionId: CHECKPOINT_OPTION.clarifyRules,
    });
    const detail = await eventually(async () => {
      const view = await getConversationDetail(t.db, conversationId);
      return view?.messages.some((message) => message.role === 'assistant') ? view : null;
    });
    expect(
      detail.approvals.every((approval) => approval.kind === 'clarify' || !approval.autoContinueAt),
    ).toBe(true);
  }, 60_000);
});
