import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Approval } from '@spark-outpost/contracts';
import { getApproval } from '../src/persistence/approvals.ts';
import { getConversationDetail } from '../src/persistence/conversations.ts';
import { loadOrchestration } from '../src/persistence/orchestrations.ts';
import { getRun } from '../src/persistence/runs.ts';
import { stopRun } from '../src/workflow/stop-run.ts';
import {
  COMPLEX,
  connectProviders,
  driveToEnd,
  gitRepo,
  jevFetch,
  removeRepo,
  startOrchestrator,
  startScenario,
  TRIVIAL,
  withTag,
  type Harness,
  type JevScript,
} from './orchestration-support.ts';
import { expectConformantRun } from './agui-conformance.ts';
import { createTestApp, LOCAL_HEADERS, ORIGIN } from './app-support.ts';
import { createTestDb, eventually, eventTypes, type TestDb } from './support.ts';

let t: TestDb;
let root: string;
let logs: string;
let harness: Harness | null = null;
let script: JevScript;

beforeEach(async () => {
  t = await createTestDb();
  root = await gitRepo();
  logs = await mkdtemp(join(tmpdir(), 'spark-stop-'));
  script = { calls: [], scenario: COMPLEX };
  await connectProviders(t, true);
});

afterEach(async () => {
  await harness?.stop();
  harness = null;
  await t.cleanup();
  await removeRepo(root);
  await rm(logs, { recursive: true, force: true });
});

const cancelLog = () => join(logs, 'cancels.log');

function start() {
  harness = startOrchestrator(t, jevFetch(script), {
    agentEnv: { FAKE_ACP_CANCEL_LOG: cancelLog() },
  });
}

async function cancelsReceived(): Promise<number> {
  const text = await readFile(cancelLog(), 'utf8').catch(() => '');
  return text.split('\n').filter(Boolean).length;
}

async function streamingBuilder(runId: string) {
  return eventually(async () => {
    const view = await loadOrchestration(t.db, runId);
    const builder = view?.crew.find((member) => member.role === 'builder');
    if (builder?.status !== 'running') return null;
    const { rows } = await t.db.query(
      `SELECT 1 FROM run_events WHERE run_id = $1 AND payload::text LIKE '%notes.txt%'`,
      [builder.runId],
    );
    return rows.length > 0 ? builder : null;
  }, 30_000);
}

async function finished(runId: string) {
  return eventually(async () => {
    const run = await getRun(t.db, runId);
    return run?.finishedAt ? run : null;
  }, 30_000);
}

async function pendingApproval(conversationId: string): Promise<Approval> {
  return eventually(async () => {
    const detail = await getConversationDetail(t.db, conversationId);
    return detail?.approvals.find((approval) => approval.status === 'pending');
  }, 30_000);
}

async function terminalEvents(runId: string): Promise<number> {
  const types = await eventTypes(t.db, runId);
  return types.filter((type) => type === 'RUN_FINISHED' || type === 'RUN_ERROR').length;
}

describe('Stop on a top-level run', () => {
  it('cancels the orchestration and its running Builder, and tells the agent to cancel', async () => {
    start();
    const { runId } = await startScenario(t, root, withTag(COMPLEX, '#slowbuild'), 'full-auto');
    const builder = await streamingBuilder(runId);
    const stopped = await stopRun(t.db, runId);
    expect(stopped?.outcome).toBe('stopping');
    expect(stopped?.run.cancelRequested).toBe(true);
    expect((await getRun(t.db, builder.runId))?.cancelRequested).toBe(true);
    expect((await finished(runId)).status).toBe('cancelled');
    expect(await getRun(t.db, builder.runId)).toMatchObject({
      status: 'cancelled',
      cancelRequested: true,
    });
    expect(await cancelsReceived()).toBeGreaterThan(0);
    await expectConformantRun(t.db, runId);
  }, 60_000);

  it('stops a Builder that ignores the cancel by ending its agent process', async () => {
    start();
    const { runId } = await startScenario(t, root, withTag(COMPLEX, '#stubbornbuild'), 'full-auto');
    const builder = await streamingBuilder(runId);
    await stopRun(t.db, runId);
    expect((await finished(runId)).status).toBe('cancelled');
    expect((await getRun(t.db, builder.runId))?.status).toBe('cancelled');
    expect(await cancelsReceived()).toBeGreaterThan(0);
  }, 60_000);

  it('cancels the waiting approval card and the run when stopped while waiting', async () => {
    start();
    const { conversationId, runId } = await startScenario(
      t,
      root,
      TRIVIAL,
      'hands-off',
      'auto',
      'sonnet',
      'default',
    );
    const approval = await pendingApproval(conversationId);
    await stopRun(t.db, runId);
    expect((await finished(runId)).status).toBe('cancelled');
    expect(await getApproval(t.db, approval.id)).toMatchObject({
      status: 'cancelled',
      decidedBy: 'stop',
    });
    const detail = await getConversationDetail(t.db, conversationId);
    expect(detail?.approvals.filter((item) => item.status === 'pending')).toEqual([]);
  }, 60_000);

  it('treats a second Stop as the same request', async () => {
    start();
    const { runId } = await startScenario(t, root, withTag(COMPLEX, '#slowbuild'), 'full-auto');
    await streamingBuilder(runId);
    const first = await stopRun(t.db, runId);
    const second = await stopRun(t.db, runId);
    expect(second?.run.cancelRequested).toBe(true);
    expect(first?.run.id).toBe(second?.run.id);
    expect((await finished(runId)).status).toBe('cancelled');
    const third = await stopRun(t.db, runId);
    expect(third?.outcome).toBe('already_finished');
    expect(await terminalEvents(runId)).toBe(1);
    await expectConformantRun(t.db, runId);
  }, 60_000);

  it('answers a Stop after the run finished without changing it', async () => {
    start();
    const { conversationId, runId } = await startScenario(t, root, COMPLEX, 'hands-off');
    await driveToEnd(t, conversationId, runId);
    const before = await getRun(t.db, runId);
    const stopped = await stopRun(t.db, runId);
    expect(stopped).toMatchObject({ outcome: 'already_finished' });
    expect(stopped?.run).toEqual(before);
    expect(stopped?.run.cancelRequested).toBe(false);
  }, 60_000);

  it('cancels a queued run right away when no worker has picked it up', async () => {
    const { runId } = await startScenario(t, root, COMPLEX, 'full-auto');
    const stopped = await stopRun(t.db, runId);
    expect(stopped?.outcome).toBe('stopped');
    expect(stopped?.run).toMatchObject({ status: 'cancelled', cancelRequested: true });
    expect(await eventTypes(t.db, runId)).toEqual(['RUN_STARTED', 'RUN_FINISHED']);
    expect((await stopRun(t.db, runId))?.outcome).toBe('already_finished');
    start();
    await new Promise((resolve) => setTimeout(resolve, 300));
    const { rows } = await t.db.query<{ status: string }>(
      'SELECT status FROM jobs WHERE run_id = $1',
      [runId],
    );
    expect(rows).toEqual([{ status: 'done' }]);
    expect((await getRun(t.db, runId))?.status).toBe('cancelled');
    expect(await eventTypes(t.db, runId)).toEqual(['RUN_STARTED', 'RUN_FINISHED']);
    const { rows: usage } = await t.db.query(
      `SELECT 1 FROM run_events WHERE run_id = $1 AND payload ? 'usage'`,
      [runId],
    );
    expect(usage).toEqual([]);
    await expectConformantRun(t.db, runId);
  }, 60_000);
});

describe('POST /runs/:id/cancel', () => {
  const cancel = (id: string) =>
    request(createTestApp(t))
      .post(`/api/runs/${id}/cancel`)
      .set(LOCAL_HEADERS)
      .set('Origin', ORIGIN)
      .send({});

  it('says whether the run stopped, is stopping, or had already finished', async () => {
    const { runId } = await startScenario(t, root, COMPLEX, 'full-auto');
    const first = await cancel(runId).expect(200);
    expect(first.headers['spark-stop']).toBe('stopped');
    expect(first.body).toMatchObject({ id: runId, status: 'cancelled' });
    const again = await cancel(runId).expect(200);
    expect(again.headers['spark-stop']).toBe('already_finished');
    await cancel('00000000-0000-4000-8000-000000000000').expect(404);
    await expectConformantRun(t.db, runId);
  });
});
