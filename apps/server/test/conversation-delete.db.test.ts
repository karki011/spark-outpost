import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getConversationDetail } from '../src/persistence/conversations.ts';
import { loadOrchestration } from '../src/persistence/orchestrations.ts';
import { getRun } from '../src/persistence/runs.ts';
import {
  COMPLEX,
  connectProviders,
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
import { createTestApp, LOCAL_HEADERS, ORIGIN } from './app-support.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

let t: TestDb;
let root: string;
let logs: string;
let harness: Harness | null = null;
let script: JevScript;

beforeEach(async () => {
  t = await createTestDb();
  root = await gitRepo();
  logs = await mkdtemp(join(tmpdir(), 'spark-delete-'));
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

function remove(id: string, deleteSettleMs?: number) {
  return request(createTestApp(t, deleteSettleMs === undefined ? {} : { deleteSettleMs }))
    .delete(`/api/conversations/${id}`)
    .set(LOCAL_HEADERS)
    .set('Origin', ORIGIN)
    .send({});
}

async function conversationExists(id: string): Promise<boolean> {
  const { rows } = await t.db.query('SELECT 1 FROM conversations WHERE id = $1', [id]);
  return rows.length > 0;
}

async function runCount(conversationId: string): Promise<number> {
  const { rows } = await t.db.query('SELECT 1 FROM runs WHERE conversation_id = $1', [
    conversationId,
  ]);
  return rows.length;
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

describe('DELETE /conversations/:id on a busy chat', () => {
  it('stops a running crew, tells the agent to cancel, and deletes the chat', async () => {
    start();
    const { conversationId, runId } = await startScenario(
      t,
      root,
      withTag(COMPLEX, '#slowbuild'),
      'full-auto',
    );
    const builder = await streamingBuilder(runId);
    await remove(conversationId).expect(204);
    expect(await conversationExists(conversationId)).toBe(false);
    expect(await getRun(t.db, runId)).toBeNull();
    expect(await getRun(t.db, builder.runId)).toBeNull();
    expect(await cancelsReceived()).toBeGreaterThan(0);
  }, 60_000);

  it('deletes a chat whose run is still queued', async () => {
    const { conversationId, runId } = await startScenario(t, root, COMPLEX, 'full-auto');
    expect((await getRun(t.db, runId))?.status).toBe('queued');
    await remove(conversationId).expect(204);
    expect(await conversationExists(conversationId)).toBe(false);
    expect(await runCount(conversationId)).toBe(0);
  });

  it('deletes a chat that is waiting on an approval card', async () => {
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
    await eventually(async () => {
      const detail = await getConversationDetail(t.db, conversationId);
      return detail?.approvals.find((approval) => approval.status === 'pending');
    }, 30_000);
    await remove(conversationId).expect(204);
    expect(await conversationExists(conversationId)).toBe(false);
    const { rows } = await t.db.query('SELECT 1 FROM approvals WHERE run_id = $1', [runId]);
    expect(rows).toEqual([]);
  }, 60_000);

  it('deletes anyway when a run never settles, after the wait runs out', async () => {
    const { conversationId, runId } = await startScenario(t, root, COMPLEX, 'full-auto');
    await t.db.query(`UPDATE runs SET status = 'running', started_at = now() WHERE id = $1`, [
      runId,
    ]);
    await t.db.query(
      `UPDATE jobs SET status = 'leased', lease_token = gen_random_uuid(),
         lease_expires_at = now() + interval '1 hour'
       WHERE run_id = $1`,
      [runId],
    );
    const began = Date.now();
    await remove(conversationId, 400).expect(204);
    expect(Date.now() - began).toBeGreaterThanOrEqual(400);
    expect(await conversationExists(conversationId)).toBe(false);
    expect(await getRun(t.db, runId)).toBeNull();
  });

  it('answers 404 for a chat that does not exist', async () => {
    await remove('00000000-0000-4000-8000-000000000000').expect(404);
  });
});
