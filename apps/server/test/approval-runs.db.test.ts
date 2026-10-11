import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Approval, ConversationSummary } from '@spark-outpost/contracts';
import { randomUUID } from 'node:crypto';
import { modeForLegacy, type InvolvementLevel } from '@spark-outpost/contracts';
import { getConversationDetail, sendUserMessage } from '../src/persistence/conversations.ts';
import { updateChatSettings } from '../src/persistence/chat-settings.ts';
import { claimNextJob } from '../src/persistence/jobs.ts';
import { getRun, requestCancel } from '../src/persistence/runs.ts';
import { getApproval, insertApproval } from '../src/persistence/approvals.ts';
import { FAKE_COMMAND, FAKE_EDIT_FILE } from '../src/providers/fake-approvals.ts';
import { createFakeProvider } from '../src/providers/fake.ts';
import { APPROVAL_TIMEOUT_MESSAGE } from '../src/workflow/approval-gate.ts';
import { WAITING_OUTCOME_MESSAGE, recoverExpiredLeases } from '../src/workflow/recovery.ts';
import { startWorker, type Worker } from '../src/workflow/worker.ts';
import { expectConformantRun } from './agui-conformance.ts';
import { createTestApp, ORIGIN, LOCAL_HEADERS } from './app-support.ts';
import { doRun, insertCommandApproval, linkedConversation } from './approval-support.ts';
import { connectCliProvider, createTestDb, eventually, type TestDb } from './support.ts';

let t: TestDb;
let root: string;
let worker: Worker | null = null;

beforeEach(async () => {
  t = await createTestDb();
  root = await realpath(await mkdtemp(join(tmpdir(), 'spark-approval-runs-')));
  await writeFile(join(root, FAKE_EDIT_FILE), 'original\n');
});

afterEach(async () => {
  await worker?.stop();
  worker = null;
  await t.cleanup();
  await rm(root, { recursive: true, force: true });
});

function start(approvalTimeoutMs?: number) {
  const provider = createFakeProvider({ stepMs: 0, wordMs: 0 });
  worker = startWorker({
    db: t.db,
    providers: new Map([[provider.name, provider]]),
    leaseSeconds: 30,
    concurrency: 2,
    pollMs: 20,
    cancelPollMs: 20,
    approvalPollMs: 20,
    ...(approvalTimeoutMs ? { approvalTimeoutMs } : {}),
  });
}

async function settled(runId: string) {
  return eventually(async () => {
    const run = await getRun(t.db, runId);
    return run?.finishedAt ? run : null;
  });
}

async function waitingApproval(conversationId: string): Promise<Approval> {
  return eventually(async () => {
    const detail = await getConversationDetail(t.db, conversationId);
    return detail?.approvals.find((approval) => approval.status === 'pending') ?? null;
  });
}

const api = () => createTestApp(t);
const post = (path: string, body: object = {}) =>
  request(api()).post(path).set(LOCAL_HEADERS).set('Origin', ORIGIN).send(body);

describe('Do runs with approvals', () => {
  it('waits for the user, flags the chat, and finishes after an allow', async () => {
    start();
    const { conversationId, runId } = await doRun(t, root, '#approve');
    const approval = await waitingApproval(conversationId);
    expect(approval).toMatchObject({ kind: 'execute', payload: { command: FAKE_COMMAND } });
    const list = await request(api()).get('/api/conversations').set(LOCAL_HEADERS);
    expect(list.body.find((c: ConversationSummary) => c.id === conversationId)).toMatchObject({
      needsInput: true,
      attention: {
        kind: 'permission',
        title: `run ${FAKE_COMMAND}`,
        agentName: null,
        provider: 'fake',
        approvalId: approval.id,
      },
    });

    await post(`/api/approvals/${approval.id}/decision`, {
      optionId: 'allow',
      scope: 'once',
      payloadHash: approval.payloadHash,
    }).expect(200);
    expect((await settled(runId)).status).toBe('succeeded');
    const detail = await getConversationDetail(t.db, conversationId);
    expect(detail?.approvals).toEqual([
      expect.objectContaining({
        id: approval.id,
        status: 'allowed',
        decidedBy: 'user',
        decisionOptionId: 'allow',
      }),
    ]);
    expect(approval.runId).toBe(runId);
    expect(detail?.activity[runId]?.map((step) => step.name)).toContain(
      `Allowed \`${FAKE_COMMAND}\` (you allowed it)`,
    );
    expect(detail?.runs[0]).toMatchObject({ mode: 'do', level: 'hands-off', snapshot: 'files' });
  });

  it("lists the agent's own plan approval as a plan to review, not a step to allow", async () => {
    const { conversationId, runId } = await doRun(t, root);
    const approval = await insertApproval(t.db, {
      runId,
      toolCallId: 'plan-1',
      rpcId: null,
      kind: 'other',
      title: 'Approve Plan',
      payload: {
        command: null,
        cwd: null,
        paths: [],
        diffs: [],
        truncated: false,
        plan: '# Add CSV export',
      },
      options: [
        { optionId: 'allow', name: 'Approve', kind: 'allow_once' },
        { optionId: 'reject', name: 'Keep planning', kind: 'reject_once' },
      ],
      reason: null,
    });
    const list = await request(api()).get('/api/conversations').set(LOCAL_HEADERS);
    expect(list.body.find((c: ConversationSummary) => c.id === conversationId)).toMatchObject({
      needsInput: true,
      attention: { kind: 'plan', title: 'Approve Plan', approvalId: approval.id },
    });
  });

  it('answers 409 when the approval was already decided', async () => {
    start();
    const { conversationId } = await doRun(t, root, '#approve');
    const approval = await waitingApproval(conversationId);
    await post(`/api/approvals/${approval.id}/decision`, { optionId: 'reject' }).expect(200);
    await post(`/api/approvals/${approval.id}/decision`, { optionId: 'allow' }).expect(409);
  });

  it('cancels the run and the approval when Stop is pressed while waiting', async () => {
    start();
    const { conversationId, runId } = await doRun(t, root, '#approve');
    const approval = await waitingApproval(conversationId);
    await requestCancel(t.db, runId);
    expect((await settled(runId)).status).toBe('cancelled');
    expect(await getApproval(t.db, approval.id)).toMatchObject({
      status: 'cancelled',
      decidedBy: 'stop',
    });
    const detail = await getConversationDetail(t.db, conversationId);
    expect(detail?.approvals).toEqual([]);
    await expectConformantRun(t.db, runId);
    const { rows } = await t.db.query<{ type: string; interrupted: string | null }>(
      `SELECT type, payload #>> '{metadata,spark,interrupted}' AS interrupted FROM run_events
       WHERE run_id = $1 ORDER BY seq DESC LIMIT 2`,
      [runId],
    );
    expect(rows).toEqual([
      { type: 'RUN_FINISHED', interrupted: null },
      { type: 'STEP_FINISHED', interrupted: 'true' },
    ]);
    expect(detail?.activity[runId]?.at(-1)?.done).toBe(false);
  });

  it('fails the run when nobody answers in time', async () => {
    start(150);
    const { runId } = await doRun(t, root, '#approve');
    const run = await settled(runId);
    expect(run).toMatchObject({ status: 'failed', error: APPROVAL_TIMEOUT_MESSAGE });
    const { rows } = await t.db.query('SELECT status FROM approvals WHERE run_id = $1', [runId]);
    expect(rows).toEqual([{ status: 'expired' }]);
    await expectConformantRun(t.db, runId);
  });

  it('expires pending approvals when a crashed run is recovered', async () => {
    const { runId } = await doRun(t, root, '#approve');
    const lease = (await claimNextJob(t.db, 30))!;
    expect(lease.runId).toBe(runId);
    const approval = await insertCommandApproval(t, runId, root, 'ls');
    await t.db.query(`UPDATE jobs SET lease_expires_at = now() - interval '1 second'`);
    expect(await recoverExpiredLeases(t.db)).toBe(1);
    expect(await getRun(t.db, runId)).toMatchObject({
      status: 'outcome_unknown',
      error: WAITING_OUTCOME_MESSAGE,
    });
    expect(await getApproval(t.db, approval.id)).toMatchObject({
      status: 'expired',
      decidedBy: 'recovery',
    });
    await expectConformantRun(t.db, runId);
  });
});

async function askRun(level: InvolvementLevel) {
  const linked = await linkedConversation(t, root);
  await connectCliProvider(t, 'claude');
  await updateChatSettings(t.db, linked.conversationId, { level });
  const sent = await sendUserMessage(
    t.db,
    linked.conversationId,
    { id: randomUUID(), content: 'Check the site #curl' },
    {
      provider: 'fake',
      permission: 'ask',
      agentMode: modeForLegacy('codex', 'ask', level),
      level,
    },
  );
  return { conversationId: linked.conversationId, runId: sent.run.id };
}

describe('Ask runs with commands', () => {
  it('runs a command without asking at Automatic', async () => {
    start();
    const { conversationId, runId } = await askRun('hands-off');
    expect((await settled(runId)).status).toBe('succeeded');
    const detail = await getConversationDetail(t.db, conversationId);
    expect(detail?.approvals.filter((approval) => approval.decidedBy !== 'level')).toEqual([]);
    expect(detail?.activity[runId]?.map((step) => step.name)).toContain(
      'Allowed `curl -sI https://example.com` (Automatic in an Ask turn)',
    );
    expect(await readFile(join(root, FAKE_EDIT_FILE), 'utf8')).toBe('original\n');
  });
});

describe('revert to before the run', () => {
  async function allowEdit(content = '#edit') {
    start();
    const run = await doRun(t, root, content);
    const approval = await waitingApproval(run.conversationId);
    await post(`/api/approvals/${approval.id}/decision`, { optionId: 'allow' }).expect(200);
    await settled(run.runId);
    const { rows } = await t.db.query<{
      status: string;
      decided_by: string;
      payload: Approval['payload'];
    }>(`SELECT status, decided_by, payload FROM approvals WHERE kind = 'accept'`);
    expect(rows).toMatchObject([{ status: 'allowed', decided_by: 'level' }]);
    expect(rows[0]!.payload.checkpoint).toMatchObject({
      keptBy: 'hands-off',
      files: [{ path: FAKE_EDIT_FILE, change: 'modified' }],
    });
    return run;
  }

  it('restores files the harness recorded outside git, once', async () => {
    const { runId } = await allowEdit();
    const target = join(root, FAKE_EDIT_FILE);
    expect(await readFile(target, 'utf8')).toBe('original\nEdited by the fake agent\n');
    const changes = await request(api()).get(`/api/runs/${runId}/changes`).set(LOCAL_HEADERS);
    expect(changes.body).toMatchObject({
      revertible: true,
      files: [{ path: FAKE_EDIT_FILE, change: 'modified' }],
    });
    await post(`/api/runs/${runId}/revert`).expect(200);
    expect(await readFile(target, 'utf8')).toBe('original\n');
    await post(`/api/runs/${runId}/revert`).expect(409);
    expect((await getRun(t.db, runId))?.revertedAt).not.toBeNull();
  });

  it('restores only files changed during the run in git, leaving the index alone', async () => {
    const git = (...args: string[]) =>
      execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
    git('init', '-q');
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '.');
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'base');
    await writeFile(join(root, 'staged.txt'), 'staged\n');
    git('add', 'staged.txt');
    const { runId } = await allowEdit();
    await writeFile(join(root, 'added-by-run.txt'), 'new\n');
    const changes = await request(api()).get(`/api/runs/${runId}/changes`).set(LOCAL_HEADERS);
    expect(changes.body.files).toEqual([
      { path: 'added-by-run.txt', change: 'added' },
      { path: FAKE_EDIT_FILE, change: 'modified' },
    ]);
    await post(`/api/runs/${runId}/revert`).expect(200);
    expect(await readFile(join(root, FAKE_EDIT_FILE), 'utf8')).toBe('original\n');
    expect(git('status', '--porcelain')).toBe('A  staged.txt\n');
    expect(git('for-each-ref', '--format=%(refname)')).toContain(
      `refs/spark-outpost/runs/${runId}`,
    );
  });
});
