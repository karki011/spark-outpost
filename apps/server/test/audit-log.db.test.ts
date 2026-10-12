import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAcpProvider } from '../src/agents/acp/acp-provider.ts';
import { agentDefinitions } from '../src/agents/acp/agents.ts';
import { createProtocolRecorder, type ProtocolEntry } from '../src/audit/protocol-entry.ts';
import {
  insertProtocolEntries,
  listProtocolLog,
  pruneProtocolLog,
  verifyRunLog,
} from '../src/persistence/audit-log.ts';
import { createConversation, sendUserMessage } from '../src/persistence/conversations.ts';
import { claimNextJob, type Lease } from '../src/persistence/jobs.ts';
import { LeaseLostError } from '../src/persistence/run-events.ts';
import { getRun } from '../src/persistence/runs.ts';
import { startWorker, type Worker } from '../src/workflow/worker.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';
import { FAKE_ACP_LAUNCH } from './fake-acp-support.ts';
import { FAKE_AGENT_MODES } from './fake-agent-modes.ts';

let t: TestDb;
let worker: Worker | null = null;

beforeEach(async () => {
  t = await createTestDb();
});

afterEach(async () => {
  await worker?.stop();
  worker = null;
  await t.cleanup();
});

async function leasedRun(provider = 'fake'): Promise<Lease> {
  const conversation = await createConversation(t.db, t.workspaceId, randomUUID());
  await sendUserMessage(t.db, conversation.id, { id: randomUUID(), content: 'hi' }, { provider });
  const lease = await claimNextJob(t.db, 30);
  if (!lease) throw new Error('No job to claim');
  return lease;
}

function entries(count: number, start = 1): ProtocolEntry[] {
  const recorder = createProtocolRecorder();
  return Array.from({ length: count }, (_, index) => {
    const id = start + index;
    const direction = id % 2 === 1 ? 'to_agent' : 'from_agent';
    const message =
      direction === 'to_agent'
        ? { jsonrpc: '2.0', id, method: id === 1 ? 'initialize' : 'session/prompt', params: {} }
        : { jsonrpc: '2.0', method: 'session/update', params: { text: `chunk ${id}` } };
    return recorder.entry(direction, message, new Date(Date.UTC(2026, 8, 26, 10, 0, id)));
  });
}

const page = (runId: string, query: Partial<Parameters<typeof listProtocolLog>[2]> = {}) =>
  listProtocolLog(t.db, runId, { after: 0, limit: 100, ...query });

describe('protocol log storage', () => {
  it('filters the log to one sub-agent: its own messages and the ones that start and end it', async () => {
    const lease = await leasedRun();
    const recorder = createProtocolRecorder();
    const update = (sessionId: string, body: Record<string, unknown>, second: number) =>
      recorder.entry(
        'from_agent',
        { jsonrpc: '2.0', method: 'session/update', params: { sessionId, update: body } },
        new Date(Date.UTC(2026, 8, 26, 10, 0, second)),
      );
    await insertProtocolEntries(t.db, lease, [
      update(
        'root',
        { sessionUpdate: 'subagent_spawned', subagentSessionId: 's1', name: 'Explore' },
        1,
      ),
      update('s1', { sessionUpdate: 'tool_call', toolCallId: 't1', title: 'Read a.ts' }, 2),
      update('root', { sessionUpdate: 'tool_call', toolCallId: 't2', title: 'Read b.ts' }, 3),
      update('s2', { sessionUpdate: 'tool_call', toolCallId: 't3', title: 'Read c.ts' }, 4),
      update(
        'root',
        { sessionUpdate: 'subagent_state_update', subagentSessionId: 's1', state: 'completed' },
        5,
      ),
    ]);
    const { entries: rows } = await page(lease.runId, { subagent: 's1' });
    expect(rows.map((row) => row.seq)).toEqual([1, 2, 5]);
  });

  it('appends batches with continuous seq numbers and a hash chain', async () => {
    const lease = await leasedRun();
    await insertProtocolEntries(t.db, lease, entries(3));
    await insertProtocolEntries(t.db, lease, entries(2, 4));
    const { entries: rows } = await page(lease.runId);
    expect(rows.map((row) => row.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(rows[0]).toMatchObject({
      direction: 'to_agent',
      kind: 'request',
      method: 'initialize',
      rpcId: '1',
      at: '2026-09-26T10:00:01.000Z',
      prevHash: null,
    });
    expect(rows[3]!.prevHash).toBe(rows[2]!.hash);
    expect(await verifyRunLog(t.db, lease.runId)).toEqual({
      runId: lease.runId,
      intact: true,
      checked: 5,
      firstBrokenSeq: null,
      reason: null,
      pruned: false,
    });
  });

  it('refuses writes without the lease', async () => {
    const lease = await leasedRun();
    const stale = { ...lease, token: randomUUID() };
    await expect(insertProtocolEntries(t.db, stale, entries(1))).rejects.toBeInstanceOf(
      LeaseLostError,
    );
    expect((await page(lease.runId)).entries).toEqual([]);
  });

  it('pages with after and limit, and filters by direction, method, and text', async () => {
    const lease = await leasedRun();
    await insertProtocolEntries(t.db, lease, entries(7));
    const first = await page(lease.runId, { limit: 3 });
    expect(first.entries.map((row) => row.seq)).toEqual([1, 2, 3]);
    expect(first.nextAfter).toBe(3);
    const last = await page(lease.runId, { after: 6, limit: 3 });
    expect(last).toMatchObject({ entries: [{ seq: 7 }], nextAfter: null });
    const incoming = await page(lease.runId, { direction: 'from_agent' });
    expect(incoming.entries.map((row) => row.seq)).toEqual([2, 4, 6]);
    const prompts = await page(lease.runId, { method: 'session/prompt' });
    expect(prompts.entries.map((row) => row.seq)).toEqual([3, 5, 7]);
    const text = await page(lease.runId, { q: 'CHUNK 4' });
    expect(text.entries.map((row) => row.seq)).toEqual([4]);
    expect((await page(lease.runId, { q: '100%' })).entries).toEqual([]);
  });

  it('detects edited and deleted rows', async () => {
    const lease = await leasedRun();
    await insertProtocolEntries(t.db, lease, entries(4));
    await t.db.query(
      `UPDATE run_protocol_log SET payload = '{"text":"forged"}' WHERE run_id = $1 AND seq = 3`,
      [lease.runId],
    );
    expect(await verifyRunLog(t.db, lease.runId)).toMatchObject({
      intact: false,
      checked: 2,
      firstBrokenSeq: 3,
      reason: 'hash does not match the row content',
    });
    await t.db.query('DELETE FROM run_protocol_log WHERE run_id = $1 AND seq = 3', [lease.runId]);
    expect(await verifyRunLog(t.db, lease.runId)).toMatchObject({
      intact: false,
      firstBrokenSeq: 4,
      reason: 'expected seq 3',
    });
  });

  it('verifies long logs across batches and finds a forged row deep inside', async () => {
    const lease = await leasedRun();
    await insertProtocolEntries(t.db, lease, entries(260));
    expect(await verifyRunLog(t.db, lease.runId)).toMatchObject({ intact: true, checked: 260 });
    await t.db.query(
      `UPDATE run_protocol_log SET payload = '{"text":"forged"}' WHERE run_id = $1 AND seq = 213`,
      [lease.runId],
    );
    expect(await verifyRunLog(t.db, lease.runId)).toMatchObject({
      intact: false,
      checked: 212,
      firstBrokenSeq: 213,
    });
  });

  it('prunes logs of runs past retention and keeps the run and its metrics', async () => {
    const old = await leasedRun();
    await insertProtocolEntries(t.db, old, entries(2));
    const recent = await leasedRun();
    await insertProtocolEntries(t.db, recent, entries(2));
    await t.db.query(
      `UPDATE runs SET finished_at = now() - interval '91 days', input_tokens = 5 WHERE id = $1`,
      [old.runId],
    );
    expect(await pruneProtocolLog(t.db, 90)).toBe(2);
    expect(await pruneProtocolLog(t.db, 90)).toBe(0);
    expect((await page(old.runId)).entries).toEqual([]);
    expect((await page(recent.runId)).entries).toHaveLength(2);
    expect(await verifyRunLog(t.db, old.runId)).toMatchObject({
      intact: true,
      checked: 0,
      pruned: true,
    });
    const { rows } = await t.db.query('SELECT input_tokens FROM runs WHERE id = $1', [old.runId]);
    expect(rows[0]).toEqual({ input_tokens: 5 });
  });
});

describe('worker audit recording with an ACP agent', { timeout: 30_000 }, () => {
  it('stores every protocol message and the settings, duration, and tool calls it used', async () => {
    const provider = createAcpProvider({
      definition: { ...agentDefinitions.codex, name: 'Fake', ...FAKE_AGENT_MODES },
      launch: FAKE_ACP_LAUNCH,
    });
    worker = startWorker({
      db: t.db,
      providers: new Map([['codex', provider]]),
      leaseSeconds: 30,
      concurrency: 1,
      pollMs: 20,
      cancelPollMs: 20,
    });
    const conversation = await createConversation(t.db, t.workspaceId, randomUUID());
    const sent = await sendUserMessage(
      t.db,
      conversation.id,
      { id: randomUUID(), content: '#secret' },
      { provider: 'codex', model: 'smart-2', effort: 'high' },
    );
    const runId = sent.run.id;
    const run = await eventually(async () => {
      const current = await getRun(t.db, runId);
      return current?.finishedAt ? current : null;
    }, 20_000);
    expect(run.status).toBe('succeeded');

    const { entries: rows } = await page(runId, { limit: 500 });
    expect(rows[0]).toMatchObject({
      direction: 'harness',
      method: 'codex/developer_instructions',
    });
    const protocol = rows.filter((row) => row.kind !== 'stderr' && row.direction !== 'harness');
    expect(protocol[0]).toMatchObject({ direction: 'to_agent', method: 'initialize' });
    expect(protocol.at(-1)).toMatchObject({ direction: 'from_agent', method: 'session/prompt' });
    expect(rows.some((row) => row.kind === 'stderr')).toBe(true);
    const stored = JSON.stringify(rows.map((row) => row.payload));
    expect(stored).not.toContain('sk-proj-abcdefghijklmnopqrstuvwx');
    expect(stored).not.toContain('hello-from-dotenv');
    expect(stored).not.toContain('abc123def456ghi789');
    expect((await verifyRunLog(t.db, runId)).intact).toBe(true);

    const { rows: metrics } = await t.db.query(
      `SELECT used_model, used_effort, used_mode, tool_call_count, duration_ms > 0 AS timed,
         cost_source FROM runs WHERE id = $1`,
      [runId],
    );
    expect(metrics[0]).toEqual({
      used_model: 'smart-2',
      used_effort: 'high',
      used_mode: 'read-only',
      tool_call_count: 2,
      timed: true,
      cost_source: null,
    });
  });
});
