import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addIslandRequest } from '../src/companion/island-requests.ts';
import { INBOX_REFUSALS } from '../src/spark-mcp/actions/ask-spark-inbox.ts';
import { insertApproval } from '../src/persistence/approvals.ts';
import { createTestApp, localClient } from './app-support.ts';
import { assistantRun, assistantScope, assistantSetup, setActs } from './ask-spark-support.ts';
import {
  confirmCard,
  recordedHooks,
  startSparkTools,
  type RecordedHooks,
  type SparkToolsHarness,
} from './spark-mcp-support.ts';
import { createTestDb, startChat, type TestDb } from './support.ts';

let t: TestDb;
let recorded: RecordedHooks;
let tools: SparkToolsHarness | null = null;
let assistant: string;

beforeEach(async () => {
  t = await createTestDb();
  assistant = await assistantSetup(t);
  recorded = recordedHooks();
});

afterEach(async () => {
  recorded.stop();
  await tools?.close();
  tools = null;
  await t.cleanup();
});

async function open(question = 'Tidy up for me') {
  const runId = await assistantRun(t, assistant, question);
  tools = await startSparkTools(t, assistantScope(assistant, runId, recorded));
  return { tools, runId };
}

async function waitingCard(runId: string) {
  return insertApproval(t.db, {
    runId,
    toolCallId: `call-${randomUUID()}`,
    rpcId: null,
    kind: 'execute',
    title: 'Run pnpm deploy',
    payload: { command: 'pnpm deploy', cwd: null, paths: [], diffs: [], truncated: false },
    options: [
      { optionId: 'allow', name: 'Allow once', kind: 'allow_once' },
      { optionId: 'reject', name: 'Deny', kind: 'reject_once' },
    ],
    reason: null,
  });
}

async function seenAt(conversationId: string) {
  const { rows } = await t.db.query<{ seen_at: Date | null }>(
    'SELECT seen_at FROM conversations WHERE id = $1',
    [conversationId],
  );
  return rows[0]?.seen_at ?? null;
}

async function islandRequests() {
  const { rows } = await t.db.query<{ kind: string; target: string }>(
    'SELECT kind, target FROM island_requests',
  );
  return rows;
}

async function setAsideKeys() {
  const { rows } = await t.db.query<{ key: string }>(
    'SELECT key FROM attention_marks WHERE set_aside_at IS NOT NULL',
  );
  return rows.map((row) => row.key);
}

describe('Ask Spark and the Inbox', () => {
  it('clears a finished chat in Act at once and in Manual only after Do it', async () => {
    const { conversationId, runId } = await startChat(t, 'Done work');
    await t.db.query(`UPDATE runs SET status = 'succeeded' WHERE id = $1`, [runId]);
    const { tools: harness } = await open();
    await harness.call('spark_clear_finished', { chat: conversationId });
    expect(await seenAt(conversationId)).toBeNull();
    const done = await confirmCard(t);
    expect(done.payload.sparkResult?.message).toBe('Cleared “Done work” from Updates.');
    expect(await seenAt(conversationId)).not.toBeNull();

    await setActs(t, 'act');
    const other = await startChat(t, 'Other work');
    await t.db.query(`UPDATE runs SET status = 'failed' WHERE id = $1`, [other.runId]);
    const cleared = await harness.call('spark_clear_finished', { chat: other.conversationId });
    expect(cleared.json()).toMatchObject({ outcome: 'done' });
    expect(await seenAt(other.conversationId)).not.toBeNull();
    const running = await startChat(t, 'Still going');
    await t.db.query(`UPDATE runs SET status = 'running' WHERE id = $1`, [running.runId]);
    const refused = await harness.call('spark_clear_finished', { chat: running.conversationId });
    expect(refused.text).toBe(INBOX_REFUSALS.notFinished);
  });

  it('sets a waiting card aside everywhere, in Act at once and in Manual after Do it', async () => {
    const { runId } = await startChat(t, 'Deploy the site');
    const card = await waitingCard(runId);
    const { tools: harness } = await open();
    await harness.call('spark_set_aside', { card: card.id });
    expect(await setAsideKeys()).toEqual([]);
    await confirmCard(t);
    expect(await setAsideKeys()).toEqual([`approval:${card.id}`]);
    expect(await islandRequests()).toEqual([]);

    const archived = await startChat(t, 'Archived work');
    const hidden = await waitingCard(archived.runId);
    await t.db.query('UPDATE conversations SET archived_at = now() WHERE id = $1', [
      archived.conversationId,
    ]);
    const refused = await harness.call('spark_set_aside', { card: hidden.id });
    expect(refused.text).toBe(INBOX_REFUSALS.notWaiting);
    await setActs(t, 'act');
    const again = await harness.call('spark_set_aside', { card: card.id });
    expect(again.json()).toMatchObject({ outcome: 'done' });
    expect(await setAsideKeys()).toEqual([`approval:${card.id}`]);
  });

  it('lets the island claim a request once, and drops expired ones', async () => {
    const api = localClient(createTestApp(t));
    const live = await addIslandRequest(t.db, t.workspaceId, {
      kind: 'snooze_meeting',
      target: 'evt@2026-10-20T10:00:00.000Z',
      expiresAt: new Date(Date.now() + 60_000),
    });
    await addIslandRequest(t.db, t.workspaceId, {
      kind: 'join_meeting',
      target: 'evt@2026-10-20T11:00:00.000Z',
      expiresAt: new Date(Date.now() - 1_000),
    });
    const listed = await api.get('/api/island/requests');
    expect(listed.body.requests.map((request: { id: string }) => request.id)).toEqual([live]);
    const first = await api.send('post', `/api/island/requests/${live}/claim`);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ id: live, kind: 'snooze_meeting' });
    const second = await api.send('post', `/api/island/requests/${live}/claim`);
    expect(second.status).toBe(409);
  });
});
