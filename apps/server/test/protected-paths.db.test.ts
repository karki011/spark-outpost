import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ApprovalScope } from '@spark-outpost/contracts';
import {
  GIT_CONTROL_REASON,
  INSTRUCTION_REASON,
  type ApprovalRequest,
} from '../src/approvals/decide.ts';
import { ApprovalInputError, decideApproval, getApproval } from '../src/persistence/approvals.ts';
import { createApprovalGate } from '../src/workflow/approval-gate.ts';
import { ApprovalWaiters } from '../src/workflow/approval-waiters.ts';
import { commandRequest, doRun, recordingAppend, sendDo } from './approval-support.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

let t: TestDb;
let root: string;

beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'spark-protected-')));
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

const OPTIONS: ApprovalRequest['options'] = [
  { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
  { optionId: 'allow-run', name: 'Allow for this run', kind: 'allow_always' },
  { optionId: 'reject', name: 'Deny', kind: 'reject_once' },
];

function editRequest(relative: string, id = 'edit-1'): ApprovalRequest {
  const target = join(root, relative);
  return {
    ...commandRequest(root, ''),
    toolCallId: id,
    kind: 'edit',
    toolKind: 'edit',
    title: `Edit ${relative}`,
    command: null,
    cwd: null,
    paths: [target],
    diffs: [{ path: target, oldText: null, newText: 'Be terse.\n' }],
    options: OPTIONS,
  };
}

function gateFor(runId: string) {
  const waiters = new ApprovalWaiters();
  const gate = createApprovalGate({
    db: t.db,
    runId,
    provider: 'claude',
    mode: 'bypassPermissions',
    append: recordingAppend().append,
    waiters,
    pollMs: 20,
    onTimeout: () => undefined,
    backup: async () => undefined,
  });
  return { gate, waiters };
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

async function answered(
  runId: string,
  request: ApprovalRequest,
  optionId: string,
  scope: ApprovalScope,
) {
  const { gate, waiters } = gateFor(runId);
  const answer = gate.review(request, new AbortController().signal);
  const id = await pendingFor(runId);
  const pending = await getApproval(t.db, id);
  await decideApproval(t.db, t.workspaceId, id, { optionId, scope });
  waiters.notify(id);
  return { pending, answer: await answer };
}

describe('agent instruction files', () => {
  it('asks in Full auto with the diff, and never offers the run or the project', async () => {
    const run = await doRun(t, root, 'go', 'full-auto');
    const { pending, answer } = await answered(
      run.runId,
      editRequest('AGENTS.md'),
      'allow',
      'once',
    );
    expect(pending).toMatchObject({
      reason: INSTRUCTION_REASON,
      payload: {
        instructionFiles: ['AGENTS.md'],
        diffs: [{ path: 'AGENTS.md', newText: 'Be terse.\n' }],
      },
    });
    expect(pending?.options.map((option) => option.kind)).toEqual(['allow_once', 'reject_once']);
    expect(answer).toMatchObject({
      allowed: true,
      note: 'Allowed Edit `AGENTS.md` (you allowed it)',
    });
  });

  it('remembers "Allow for this chat" for that file in later runs of the chat only', async () => {
    const run = await doRun(t, root, 'go', 'full-auto');
    const first = await answered(run.runId, editRequest('CLAUDE.md'), 'allow', 'chat');
    expect(first.answer).toMatchObject({
      allowed: true,
      note: 'Allowed Edit `CLAUDE.md` (you allowed it for this chat)',
    });
    const later = await sendDo(t, run.conversationId, 'again', 'full-auto');
    const again = await gateFor(later).gate.review(
      editRequest('CLAUDE.md', 'edit-2'),
      new AbortController().signal,
    );
    expect(again).toMatchObject({ allowed: true });
    const other = await doRun(t, root, 'elsewhere', 'full-auto');
    const { gate } = gateFor(other.runId);
    const stop = new AbortController();
    const asked = gate.review(editRequest('CLAUDE.md', 'edit-3'), stop.signal);
    expect(await getApproval(t.db, await pendingFor(other.runId))).toMatchObject({
      reason: INSTRUCTION_REASON,
    });
    stop.abort();
    expect(await asked).toMatchObject({ outcome: 'cancelled' });
  });

  it('denies, and refuses chat or project scopes that do not fit', async () => {
    const run = await doRun(t, root, 'go', 'full-auto');
    const { gate, waiters } = gateFor(run.runId);
    const answer = gate.review(editRequest('.claude/settings.json'), new AbortController().signal);
    const id = await pendingFor(run.runId);
    await expect(
      decideApproval(t.db, t.workspaceId, id, { optionId: 'allow', scope: 'project' }),
    ).rejects.toBeInstanceOf(ApprovalInputError);
    await expect(
      decideApproval(t.db, t.workspaceId, id, { optionId: 'reject', scope: 'chat' }),
    ).rejects.toBeInstanceOf(ApprovalInputError);
    await decideApproval(t.db, t.workspaceId, id, { optionId: 'reject', scope: 'once' });
    waiters.notify(id);
    expect(await answer).toMatchObject({ allowed: false });
  });
});

describe('git hooks and git config', () => {
  it('asks in Full auto, allows once only, and never for the chat', async () => {
    const run = await doRun(t, root, 'go', 'full-auto');
    const { gate, waiters } = gateFor(run.runId);
    const request = {
      ...commandRequest(root, 'cp hook.sh .git/hooks/pre-commit'),
      options: OPTIONS,
    };
    const answer = gate.review(request, new AbortController().signal);
    const id = await pendingFor(run.runId);
    expect(await getApproval(t.db, id)).toMatchObject({
      reason: GIT_CONTROL_REASON,
      payload: { gitControl: ['.git/hooks/pre-commit'] },
    });
    for (const scope of ['run', 'chat'] as const) {
      await expect(
        decideApproval(t.db, t.workspaceId, id, { optionId: 'allow', scope }),
      ).rejects.toBeInstanceOf(ApprovalInputError);
    }
    await decideApproval(t.db, t.workspaceId, id, { optionId: 'allow', scope: 'once' });
    waiters.notify(id);
    expect(await answer).toMatchObject({ allowed: true });
  });
});
