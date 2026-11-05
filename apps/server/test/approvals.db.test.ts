import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { APPROVAL_DECIDED, APPROVAL_REQUESTED, type ApprovalScope } from '@spark-outpost/contracts';
import {
  ApprovalConflictError,
  ApprovalInputError,
  decideApproval,
  getApproval,
} from '../src/persistence/approvals.ts';
import { getProject } from '../src/projects/projects.ts';
import type { GateAnswer } from '../src/providers/provider.ts';
import { createApprovalGate } from '../src/workflow/approval-gate.ts';
import { ApprovalWaiters } from '../src/workflow/approval-waiters.ts';
import {
  commandRequest,
  doRun,
  insertCommandApproval,
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
  mode = 'default',
  options: { timeoutMs?: number; onTimeout?: () => void } = {},
) {
  const recorded = recordingAppend();
  const waiters = new ApprovalWaiters();
  const gate = createApprovalGate({
    db: t.db,
    runId,
    provider: 'claude',
    mode,
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

async function answerOnce(
  run: LinkedRun,
  command: string,
  optionId: string,
  scope: ApprovalScope = 'once',
) {
  const { gate, waiters } = gateFor(run.runId);
  const answer = gate.review(commandRequest(root, command), new AbortController().signal);
  const id = await pendingFor(run.runId);
  await decideApproval(t.db, t.workspaceId, id, { optionId, scope });
  waiters.notify(id);
  return { answer: await answer, id };
}

describe('approval gate', () => {
  it("sends the agent's own always options back and never asks twice in the run", async () => {
    const run = await doRun(t, root);
    const { gate, waiters } = gateFor(run.runId);
    const request = {
      ...commandRequest(root, 'pnpm build'),
      options: [
        { optionId: 'yes', name: 'Yes', kind: 'allow_once' as const },
        { optionId: 'yes-always', name: "Yes, and don't ask again", kind: 'allow_always' as const },
        { optionId: 'no', name: 'No', kind: 'reject_once' as const },
        { optionId: 'no-always', name: "No, and don't ask again", kind: 'reject_always' as const },
      ],
    };
    const first = gate.review(request, new AbortController().signal);
    const id = await pendingFor(run.runId);
    const decided = await decideApproval(t.db, t.workspaceId, id, {
      optionId: 'no-always',
      scope: 'once',
    });
    waiters.notify(id);
    expect(decided).toMatchObject({
      status: 'denied',
      scope: 'run',
      decisionOptionId: 'no-always',
    });
    expect(await first).toMatchObject({
      outcome: 'selected',
      optionId: 'no-always',
      allowed: false,
    });
    const again = await gate.review(
      { ...request, toolCallId: 'call-2' },
      new AbortController().signal,
    );
    expect(again).toMatchObject({
      allowed: false,
      note: expect.stringContaining('always reject this in this run'),
    });

    const other = { ...request, toolCallId: 'call-3', command: 'pnpm lint', title: 'pnpm lint' };
    const allowed = gate.review(other, new AbortController().signal);
    const second = await pendingFor(run.runId);
    await decideApproval(t.db, t.workspaceId, second, { optionId: 'yes-always', scope: 'once' });
    waiters.notify(second);
    expect(await allowed).toMatchObject({ optionId: 'yes-always', allowed: true });
    expect(
      await gate.review({ ...other, toolCallId: 'call-4' }, new AbortController().signal),
    ).toMatchObject({
      allowed: true,
      note: 'Allowed `pnpm lint` (allowed for this run)',
      quiet: true,
    });
  });

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
      approvalId: id,
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
      quiet: true,
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
    const manual = gateFor(next).gate;
    expect(
      await manual.review(commandRequest(root, 'pnpm test -- unit'), new AbortController().signal),
    ).toMatchObject({
      allowed: true,
      note: 'Allowed `pnpm test -- unit` (on the project allowlist)',
    });
    const unlisted = await sendDo(t, run.conversationId, 'third');
    const controller = new AbortController();
    const asked = gateFor(unlisted).gate.review(
      commandRequest(root, 'pnpm build'),
      controller.signal,
    );
    expect(await pendingFor(unlisted)).toBeTruthy();
    controller.abort();
    await asked;
  });

  it('records a receipt without asking when the mode allows it', async () => {
    const run = await doRun(t, root, 'go', 'full-auto');
    const { gate, events } = gateFor(run.runId, 'bypassPermissions');
    const answer = await gate.review(
      commandRequest(root, 'rm -rf build'),
      new AbortController().signal,
    );
    expect(answer).toMatchObject({
      allowed: true,
      note: 'Allowed `rm -rf build` (bypassPermissions mode)',
    });
    expect(events).toHaveLength(0);
    const { rows } = await t.db.query(`SELECT status, decided_by, decided_at FROM approvals`);
    expect(rows[0]).toMatchObject({ status: 'allowed', decided_by: 'level' });
  });

  it('asks before a push below Full auto', async () => {
    const run = await doRun(t, root, 'go');
    const { gate, waiters } = gateFor(run.runId);
    const answer = gate.review(
      commandRequest(root, 'git push origin main'),
      new AbortController().signal,
    );
    const id = await pendingFor(run.runId);
    expect((await getApproval(t.db, id))?.reason).toBe('Pushing publishes outside this computer');
    await decideApproval(t.db, t.workspaceId, id, { optionId: 'reject', scope: 'once' });
    waiters.notify(id);
    expect(await answer).toMatchObject({ allowed: false });
  });

  it('refuses a plain force push even in Full auto', async () => {
    const run = await doRun(t, root, 'go', 'full-auto');
    const { gate } = gateFor(run.runId, 'bypassPermissions');
    const answer = await gate.review(
      commandRequest(root, 'git push --force origin feature'),
      new AbortController().signal,
    );
    expect(answer).toMatchObject({ allowed: false });
  });

  it('asks once, never for the run, before a lease force push even in Full auto', async () => {
    const run = await doRun(t, root, 'go', 'full-auto');
    const { gate, waiters } = gateFor(run.runId, 'bypassPermissions');
    const request = commandRequest(root, 'git push --force-with-lease origin feature');
    const answer = gate.review(
      {
        ...request,
        options: [
          ...request.options,
          { optionId: 'always', name: 'Always allow', kind: 'allow_always' },
        ],
      },
      new AbortController().signal,
    );
    const id = await pendingFor(run.runId);
    const pending = await getApproval(t.db, id);
    expect(pending).toMatchObject({
      reason: 'This rewrites history on feature on the remote',
      payload: { forcePush: ['feature'] },
    });
    expect(pending?.options.map((option) => option.kind)).toEqual(['allow_once', 'reject_once']);
    await expect(
      decideApproval(t.db, t.workspaceId, id, { optionId: 'allow', scope: 'run' }),
    ).rejects.toBeInstanceOf(ApprovalInputError);
    await decideApproval(t.db, t.workspaceId, id, { optionId: 'allow', scope: 'once' });
    waiters.notify(id);
    expect(await answer).toMatchObject({ allowed: true });
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
    const { gate } = gateFor(run.runId, 'default', {
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
  const pending = (runId: string, command = 'pnpm test') =>
    insertCommandApproval(t, runId, root, command);

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
