import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';
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
import { migrationsDir } from '../src/persistence/migrate.ts';
import { autoContinueSeconds, updateProfile } from '../src/persistence/setup.ts';
import { askCheckpoint, compactCard, type CheckpointCard } from '../src/workflow/kept-record.ts';
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

function countdownCard(): CheckpointCard {
  return compactCard('This chat is almost full.', 90);
}

async function pendingCheckpoint(runId: string, autoContinueMs: number | null) {
  const card = countdownCard();
  return insertApproval(t.db, {
    runId,
    toolCallId: `checkpoint:compact:${Math.random()}`,
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
      `SELECT id FROM approvals WHERE run_id = $1 AND kind = 'compact'`,
      [runId],
    );
    return rows[0] ? getApproval(t.db, rows[0].id) : null;
  });
}

describe('auto-continue on a card with a safe default', () => {
  it('takes the safe default once the deadline passes, decided by auto', async () => {
    const { runId } = await doRun(t, root);
    const { answer } = ask(runId, countdownCard(), 200);
    expect(await answer).toEqual({
      type: 'answered',
      optionId: CHECKPOINT_OPTION.keepGoing,
      note: null,
    });
    const settled = await checkpointOf(runId);
    expect(settled).toMatchObject({
      status: 'denied',
      decidedBy: 'auto',
      decisionOptionId: CHECKPOINT_OPTION.keepGoing,
    });
    expect(Date.parse(settled.autoContinueAt!) - Date.parse(settled.createdAt)).toBe(200);
  });

  it('never sets a deadline on a card without a safe default, or when turned off', async () => {
    const { runId } = await doRun(t, root);
    const card = countdownCard();
    const plain = { ...card, payload: { ...card.payload, autoOption: null } };
    const first = ask(runId, plain, 200);
    const pending = await checkpointOf(runId);
    expect(pending.autoContinueAt).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect((await getApproval(t.db, pending.id))?.status).toBe('pending');
    first.stop();
    await first.answer;
    const off = await pendingCheckpoint(runId, null);
    expect(off.autoContinueAt).toBeNull();
    expect(await settleIfDue(t.db, off.id, CHECKPOINT_OPTION.keepGoing)).toBeNull();
  });

  it('resolves only items that are still pending and due', async () => {
    const { runId } = await doRun(t, root);
    const later = await pendingCheckpoint(runId, 60_000);
    expect(await settleIfDue(t.db, later.id, CHECKPOINT_OPTION.keepGoing)).toBeNull();
    const due = await pendingCheckpoint(runId, 0);
    await decideApproval(t.db, t.workspaceId, due.id, {
      optionId: CHECKPOINT_OPTION.compactNow,
      scope: 'once',
    });
    expect(await settleIfDue(t.db, due.id, CHECKPOINT_OPTION.keepGoing)).toBeNull();
    expect(await getApproval(t.db, due.id)).toMatchObject({
      status: 'allowed',
      decidedBy: 'user',
      decisionOptionId: CHECKPOINT_OPTION.compactNow,
    });
  });

  it('lets exactly one of a user decision and the timeout win a race', async () => {
    const { runId } = await doRun(t, root);
    for (let round = 0; round < 5; round += 1) {
      const due = await pendingCheckpoint(runId, 0);
      const [user, auto] = await Promise.allSettled([
        decideApproval(t.db, t.workspaceId, due.id, {
          optionId: CHECKPOINT_OPTION.compactNow,
          scope: 'once',
        }),
        settleIfDue(t.db, due.id, CHECKPOINT_OPTION.keepGoing),
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
    const { answer } = ask(runId, countdownCard(), 300);
    const pending = await checkpointOf(runId);
    const held = await holdApproval(t.db, t.workspaceId, pending.id);
    expect(held).toMatchObject({ status: 'pending', autoContinueAt: null });
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect((await getApproval(t.db, pending.id))?.status).toBe('pending');
    await decideApproval(t.db, t.workspaceId, pending.id, {
      optionId: CHECKPOINT_OPTION.compactNow,
      scope: 'once',
    });
    expect(await answer).toMatchObject({
      type: 'answered',
      optionId: CHECKPOINT_OPTION.compactNow,
    });
    expect((await getApproval(t.db, pending.id))?.decidedBy).toBe('user');
  });

  it('defaults to 60 seconds and can be turned off in settings', async () => {
    expect(await autoContinueSeconds(t.db, t.workspaceId)).toBe(60);
    await updateProfile(t.db, t.workspaceId, { autoContinueSeconds: 30 });
    expect(await autoContinueSeconds(t.db, t.workspaceId)).toBe(30);
    await updateProfile(t.db, t.workspaceId, { autoContinueSeconds: null });
    expect(await autoContinueSeconds(t.db, t.workspaceId)).toBeNull();
    await updateProfile(t.db, t.workspaceId, { displayName: 'Hari' });
    expect(await autoContinueSeconds(t.db, t.workspaceId)).toBeNull();
  });

  it('keeps a custom wait and refuses one outside 1 to 600 seconds', async () => {
    await updateProfile(t.db, t.workspaceId, { autoContinueSeconds: 45 });
    expect(await autoContinueSeconds(t.db, t.workspaceId)).toBe(45);
    await updateProfile(t.db, t.workspaceId, { autoContinueSeconds: 600 });
    expect(await autoContinueSeconds(t.db, t.workspaceId)).toBe(600);
    await expect(
      updateProfile(t.db, t.workspaceId, { autoContinueSeconds: 601 }),
    ).rejects.toThrow();
    await expect(updateProfile(t.db, t.workspaceId, { autoContinueSeconds: 0 })).rejects.toThrow();
    expect(await autoContinueSeconds(t.db, t.workspaceId)).toBe(600);
  });

  it('moves a profile still on the old 10 second default to 60 and leaves other waits alone', async () => {
    const migration = await readFile(
      path.join(migrationsDir, '0123_auto_continue_default.sql'),
      'utf8',
    );
    await updateProfile(t.db, t.workspaceId, { autoContinueSeconds: 10 });
    await t.db.query(migration);
    expect(await autoContinueSeconds(t.db, t.workspaceId)).toBe(60);
    for (const kept of [30, null]) {
      await updateProfile(t.db, t.workspaceId, { autoContinueSeconds: kept });
      await t.db.query(migration);
      expect(await autoContinueSeconds(t.db, t.workspaceId)).toBe(kept);
    }
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

  it('never puts a countdown on an edit or keep card', async () => {
    repo = await gitRepo();
    await connectProviders(t);
    await updateProfile(t.db, t.workspaceId, { autoContinueSeconds: 1 });
    harness = startOrchestrator(t, jevFetch({ calls: [], scenario: TRIVIAL }));
    const { conversationId, runId } = await startScenario(t, repo, TRIVIAL, null);
    const { orchestration } = await driveToEnd(t, conversationId, runId, answerEverything);
    expect(orchestration).toMatchObject({ status: 'succeeded' });
    const detail = await eventually(async () => {
      const view = await getConversationDetail(t.db, conversationId);
      return view?.messages.some((message) => message.role === 'assistant') ? view : null;
    });
    expect(detail.approvals.length).toBeGreaterThan(0);
    expect(detail.approvals.every((approval) => !approval.autoContinueAt)).toBe(true);
  }, 60_000);
});
