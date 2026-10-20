import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addIslandRequest } from '../src/companion/island-requests.ts';
import { INBOX_REFUSALS } from '../src/spark-mcp/actions/ask-spark-inbox.ts';
import { ASSISTANT_ONE_CHAT } from '../src/outposts/post-rules.ts';
import { userText } from '../src/outposts/user-asked.ts';
import { insertApproval } from '../src/persistence/approvals.ts';
import { createTestApp, localClient } from './app-support.ts';
import { assistantRun, assistantScope, assistantSetup, setActs } from './ask-spark-support.ts';
import { addMemberChat, createOutpostRow } from './outpost-fixtures.ts';
import {
  confirmCard,
  pendingCard,
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

async function posts(outpostId: string) {
  const { rows } = await t.db.query<{
    kind: string;
    body: string;
    from_user: boolean;
    from_handle: string | null;
    to_handle: string | null;
  }>(
    `SELECT kind, body, from_user, from_handle, to_handle FROM outpost_posts
     WHERE outpost_id = $1 ORDER BY created_at`,
    [outpostId],
  );
  return rows;
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

describe('Ask Spark in outposts and the Inbox', () => {
  it('in Manual posts a request to an outpost chat after Do it, never as the user', async () => {
    const outpostId = await createOutpostRow(t, 'Orders launch');
    await addMemberChat(t, outpostId, 'api');
    const { tools: harness } = await open();
    const result = await harness.call('spark_post_outpost', {
      outpost: 'orders launch',
      message: '@api push the branch and open a pull request',
    });
    expect(result.json()).toMatchObject({ outcome: 'waiting_for_user' });
    expect((await pendingCard(t)).title).toBe(
      'Post in “Orders launch”: @api push the branch and open a pull request',
    );
    expect(await posts(outpostId)).toEqual([]);
    const done = await confirmCard(t);
    expect(done.payload.sparkResult?.message).toBe('Posted a request to @api.');
    const [post] = await posts(outpostId);
    expect(post).toMatchObject({
      kind: 'request',
      from_user: false,
      from_handle: 'ask-spark',
      to_handle: 'api',
    });
    expect(
      userText({ userRequest: post!.body, outpostRequest: { fromUser: post!.from_user } }),
    ).toBe('');
    const view = await localClient(createTestApp(t)).get(`/api/outposts/${outpostId}`);
    expect(view.status).toBe(200);
    expect(JSON.stringify(view.body)).toContain('"fromHandle":"ask-spark"');
  });

  it('in Act leaves a note at once, and never addresses every chat', async () => {
    await setActs(t, 'act');
    const outpostId = await createOutpostRow(t, 'Orders launch');
    await addMemberChat(t, outpostId, 'api');
    await addMemberChat(t, outpostId, 'web');
    const { tools: harness } = await open();
    const note = await harness.call('spark_post_outpost', {
      outpost: outpostId,
      message: 'Launch moved to Friday.',
    });
    expect(note.json()).toMatchObject({ outcome: 'done', message: 'Posted a note.' });
    const all = await harness.call('spark_post_outpost', {
      outpost: outpostId,
      message: '@all ship it',
    });
    expect(all.isError).toBe(true);
    expect(all.text).toContain(ASSISTANT_ONE_CHAT);
    expect((await posts(outpostId)).map((post) => post.kind)).toEqual(['note']);
  });

  it('clears a finished chat in Act at once and in Manual only after Do it', async () => {
    const { conversationId, runId } = await startChat(t, 'Done work');
    await t.db.query(`UPDATE runs SET status = 'succeeded' WHERE id = $1`, [runId]);
    const { tools: harness } = await open();
    await harness.call('spark_clear_finished', { chat: conversationId });
    expect(await seenAt(conversationId)).toBeNull();
    const done = await confirmCard(t);
    expect(done.payload.sparkResult?.message).toBe('Cleared “Done work” from Finished.');
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

  it('sets a waiting card aside through the island, in Act at once and in Manual after Do it', async () => {
    const { runId } = await startChat(t, 'Deploy the site');
    const card = await waitingCard(runId);
    const { tools: harness } = await open();
    await harness.call('spark_set_aside', { card: card.id });
    expect(await islandRequests()).toEqual([]);
    await confirmCard(t);
    expect(await islandRequests()).toEqual([{ kind: 'set_aside', target: card.id }]);

    await t.db.query('DELETE FROM island_requests');
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
    expect(await islandRequests()).toEqual([{ kind: 'set_aside', target: card.id }]);
  });

  it('lets the island claim a request once, and drops expired ones', async () => {
    const api = localClient(createTestApp(t));
    const live = await addIslandRequest(t.db, t.workspaceId, {
      kind: 'snooze_meeting',
      target: 'evt@2026-10-20T10:00:00.000Z',
      expiresAt: new Date(Date.now() + 60_000),
    });
    await addIslandRequest(t.db, t.workspaceId, {
      kind: 'set_aside',
      target: randomUUID(),
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
