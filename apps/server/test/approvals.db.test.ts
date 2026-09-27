import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  APPROVAL_DECIDED,
  APPROVAL_REQUESTED,
  type InvolvementLevel,
} from '@spark-outpost/contracts';
import {
  ApprovalConflictError,
  ApprovalInputError,
  decideApproval,
  getApproval,
  insertApproval,
} from '../src/persistence/approvals.ts';
import { getProject } from '../src/projects/projects.ts';
import type { GateAnswer } from '../src/providers/provider.ts';
import { createApprovalGate } from '../src/workflow/approval-gate.ts';
import { ApprovalWaiters } from '../src/workflow/approval-waiters.ts';
import {
  commandRequest,
  doRun,
  recordingAppend,
  sendDo,
  type LinkedRun,
} from './approval-support.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

let t: TestDb;
let root: string;

beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'spark-approvals-')));
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

function gateFor(
  runId: string,
  level: InvolvementLevel = 'balanced',
  options: { timeoutMs?: number; onTimeout?: () => void } = {},
) {
  const recorded = recordingAppend();
  const waiters = new ApprovalWaiters();
  const gate = createApprovalGate({
    db: t.db,
    runId,
    level,
    append: recorded.append,
    waiters,
    pollMs: 20,
    ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
    onTimeout: options.onTimeout ?? (() => undefined),
    backup: async () => undefined,
  });
  return { gate, waiters, events: recorded.events };
}

async function pendingFor(runId: string) {
  return eventually(async () => {
    const { rows } = await t.db.query<{ id: string }>(
      `SELECT id FROM approvals WHERE run_id = $1 AND status = 'pending'`,
      [runId],
    );
    return rows[0]?.id ?? null;
  });
}

async function answerOnce(run: LinkedRun, command: string, optionId: string, scope = 'once') {
  const { gate, waiters } = gateFor(run.runId);
  const answer = gate.review(commandRequest(root, command), new AbortController().signal);
  const id = await pendingFor(run.runId);
  await decideApproval(t.db, t.workspaceId, id, {
    optionId,
    scope: scope as 'once' | 'run' | 'project',
  });
  waiters.notify(id);
  return { answer: await answer, id };
}

describe('approval gate', () => {
  it('waits for the user, emits requested and decided events, and answers the chosen option', async () => {
    const run = await doRun(t, root);
    const { gate, waiters, events } = gateFor(run.runId);
    const answer = gate.review(commandRequest(root, 'pnpm test'), new AbortController().signal);
    const id = await pendingFor(run.runId);
    const decided = await decideApproval(t.db, t.workspaceId, id, {
      optionId: 'allow',
      scope: 'once',
    });
    waiters.notify(id);
    expect(await answer).toEqual({
      outcome: 'selected',
      optionId: 'allow',
      allowed: true,
      note: 'Allowed `pnpm test` (you allowed it)',
    });
    expect(decided).toMatchObject({ status: 'allowed', decidedBy: 'user', scope: 'once' });
    expect(events.map(({ event }) => ('name' in event ? event.name : event.type))).toEqual([
      APPROVAL_REQUESTED,
      APPROVAL_DECIDED,
    ]);
    expect(events[0]!.options?.transition?.status).toBe('awaiting_approval');
    expect(events[1]!.options?.transition?.status).toBe('running');
  });

  it('allows a read-only command inside the project at Balanced without asking', async () => {
    const run = await doRun(t, root);
    const { gate } = gateFor(run.runId);
    const answer = await gate.review(commandRequest(root, 'ls -la'), new AbortController().signal);
    expect(answer).toMatchObject({
      allowed: true,
      note: 'Allowed `ls -la` (a read-only command inside the project)',
    });
    const { rows } = await t.db.query(
      `SELECT decided_by, status FROM approvals WHERE run_id = $1`,
      [run.runId],
    );
    expect(rows).toEqual([{ decided_by: 'level', status: 'allowed' }]);
  });

  it('denies with the reject option', async () => {
    const run = await doRun(t, root);
    const { answer } = await answerOnce(run, 'pnpm test', 'reject');
    expect(answer).toMatchObject({ outcome: 'selected', optionId: 'reject', allowed: false });
    expect((answer as { note: string }).note).toBe('Denied: `pnpm test` (you denied it)');
  });

  it('remembers "Allow for this run" for the same command only', async () => {
    const run = await doRun(t, root);
    await answerOnce(run, 'make build', 'allow', 'run');
    const { gate } = gateFor(run.runId);
    const signal = new AbortController().signal;
    expect(await gate.review(commandRequest(root, 'make  build', 'call-2'), signal)).toMatchObject({
      allowed: true,
      note: 'Allowed `make build` (allowed for this run)',
    });
    const controller = new AbortController();
    const other = gate.review(commandRequest(root, 'make clean', 'call-3'), controller.signal);
    await pendingFor(run.runId);
    const { rows } = await t.db.query(
      `SELECT decided_by FROM approvals WHERE run_id = $1 ORDER BY created_at`,
      [run.runId],
    );
    expect(rows.map((row) => row.decided_by)).toEqual(['user', 'run_rule', null]);
    controller.abort();
    expect((await other).outcome).toBe('cancelled');
  });

  it('adds "Always allow in this project" to the allowlist and uses it on later runs', async () => {
    const run = await doRun(t, root);
    await answerOnce(run, 'pnpm test', 'allow', 'project');
    expect((await getProject(t.db, t.workspaceId, run.projectId)).commandAllowlist).toEqual([
      'pnpm test',
    ]);
    const next = await sendDo(t, run.conversationId, 'again');
    const balanced = gateFor(next).gate;
    expect(
      await balanced.review(
        commandRequest(root, 'pnpm test -- unit'),
        new AbortController().signal,
      ),
    ).toMatchObject({
      allowed: true,
      note: 'Allowed `pnpm test -- unit` (on the project allowlist)',
    });
    const handsOnRun = await sendDo(t, run.conversationId, 'third', 'hands-on');
    const controller = new AbortController();
    const asked = gateFor(handsOnRun, 'hands-on').gate.review(
      commandRequest(root, 'pnpm test'),
      controller.signal,
    );
    expect(await pendingFor(handsOnRun)).toBeTruthy();
    controller.abort();
    await asked;
  });

  it('records a receipt without asking when the level allows it', async () => {
    const run = await doRun(t, root, 'go', 'full-auto');
    const { gate, events } = gateFor(run.runId, 'full-auto');
    const answer = await gate.review(
      commandRequest(root, 'rm -rf build'),
      new AbortController().signal,
    );
    expect(answer).toMatchObject({
      allowed: true,
      note: 'Allowed `rm -rf build` (your Full auto setting)',
    });
    expect(events).toHaveLength(0);
    const { rows } = await t.db.query(`SELECT status, decided_by, decided_at FROM approvals`);
    expect(rows[0]).toMatchObject({ status: 'allowed', decided_by: 'level' });
  });

  it('always asks before a push, even in Full auto', async () => {
    const run = await doRun(t, root, 'go', 'full-auto');
    const { answer } = await (async () => {
      const { gate, waiters } = gateFor(run.runId, 'full-auto');
      const pending = gate.review(
        commandRequest(root, 'git push origin main'),
        new AbortController().signal,
      );
      const id = await pendingFor(run.runId);
      expect((await getApproval(t.db, id))?.reason).toBe('Pushing always asks');
      await decideApproval(t.db, t.workspaceId, id, { optionId: 'reject', scope: 'once' });
      waiters.notify(id);
      return { answer: await pending };
    })();
    expect(answer).toMatchObject({ allowed: false });
  });

  it('answers cancelled and marks the approval cancelled when the run stops', async () => {
    const run = await doRun(t, root);
    const { gate } = gateFor(run.runId);
    const controller = new AbortController();
    const answer = gate.review(commandRequest(root, 'pnpm build'), controller.signal);
    const id = await pendingFor(run.runId);
    controller.abort();
    expect((await answer).outcome).toBe('cancelled');
    expect(await getApproval(t.db, id)).toMatchObject({ status: 'cancelled', decidedBy: 'stop' });
  });

  it('expires after the timeout, rejects once, and reports the timeout', async () => {
    const run = await doRun(t, root);
    let timedOut = false;
    const { gate } = gateFor(run.runId, 'balanced', {
      timeoutMs: 80,
      onTimeout: () => {
        timedOut = true;
      },
    });
    const answer: GateAnswer = await gate.review(
      commandRequest(root, 'pnpm build'),
      new AbortController().signal,
    );
    expect(answer).toMatchObject({ outcome: 'selected', optionId: 'reject', allowed: false });
    expect(timedOut).toBe(true);
    const { rows } = await t.db.query(`SELECT status, decided_by FROM approvals`);
    expect(rows[0]).toEqual({ status: 'expired', decided_by: 'timeout' });
  });
});

describe('approval decisions', () => {
  async function pending(runId: string, command = 'pnpm test') {
    return insertApproval(t.db, {
      runId,
      toolCallId: 'c1',
      rpcId: null,
      kind: 'execute',
      title: command,
      payload: { command, cwd: root, paths: [], diffs: [], truncated: false },
      options: [
        { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
        { optionId: 'reject', name: 'Deny', kind: 'reject_once' },
      ],
      reason: null,
    });
  }

  it('lets exactly one of two racing decisions win', async () => {
    const { runId } = await doRun(t, root);
    const approval = await pending(runId);
    const results = await Promise.allSettled([
      decideApproval(t.db, t.workspaceId, approval.id, { optionId: 'allow', scope: 'once' }),
      decideApproval(t.db, t.workspaceId, approval.id, { optionId: 'reject', scope: 'once' }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const failed = results.find((result) => result.status === 'rejected');
    expect((failed as PromiseRejectedResult).reason).toBeInstanceOf(ApprovalConflictError);
  });

  it('refuses a decision made on a different payload', async () => {
    const { runId } = await doRun(t, root);
    const approval = await pending(runId);
    await expect(
      decideApproval(t.db, t.workspaceId, approval.id, {
        optionId: 'allow',
        scope: 'once',
        payloadHash: 'sha256:stale',
      }),
    ).rejects.toBeInstanceOf(ApprovalConflictError);
    expect((await getApproval(t.db, approval.id))?.status).toBe('pending');
    const other = await pending(runId, 'pnpm test --watch');
    expect(other.payloadHash).not.toBe(approval.payloadHash);
  });

  it('rejects scopes that do not fit the request', async () => {
    const { runId } = await doRun(t, root);
    const approval = await pending(runId);
    await expect(
      decideApproval(t.db, t.workspaceId, approval.id, { optionId: 'reject', scope: 'run' }),
    ).rejects.toBeInstanceOf(ApprovalInputError);
    await expect(
      decideApproval(t.db, t.workspaceId, approval.id, { optionId: 'nope', scope: 'once' }),
    ).rejects.toBeInstanceOf(ApprovalInputError);
  });

  it('refuses a decision after the approval was answered', async () => {
    const { runId } = await doRun(t, root);
    const approval = await pending(runId);
    await decideApproval(t.db, t.workspaceId, approval.id, { optionId: 'allow', scope: 'once' });
    await expect(
      decideApproval(t.db, t.workspaceId, approval.id, { optionId: 'allow', scope: 'once' }),
    ).rejects.toBeInstanceOf(ApprovalConflictError);
  });
});
