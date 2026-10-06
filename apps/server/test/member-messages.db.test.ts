import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getConversationDetail } from '../src/persistence/conversations.ts';
import { ApprovalConflictError, decideApproval } from '../src/persistence/approvals.ts';
import { createTestApp, LOCAL_HEADERS, ORIGIN } from './app-support.ts';
import {
  NORMAL,
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
let sessions: string;
let harness: Harness | null = null;

beforeEach(async () => {
  t = await createTestDb();
  root = await gitRepo();
  sessions = await mkdtemp(join(tmpdir(), 'spark-member-sessions-'));
  await connectProviders(t);
});

afterEach(async () => {
  await harness?.stop();
  harness = null;
  await t.cleanup();
  await removeRepo(root);
  await rm(sessions, { recursive: true, force: true });
});

const api = () => createTestApp(t, { fixedRunProvider: null });

function post(path: string, body: object) {
  return request(api()).post(path).set(LOCAL_HEADERS).set('Origin', ORIGIN).send(body);
}

interface Child {
  id: string;
  role: string;
  status: string;
  name: string;
}

async function children(runId: string): Promise<Child[]> {
  const { rows } = await t.db.query<Child>(
    `SELECT id, role, status, route->>'name' AS name FROM runs
     WHERE parent_run_id = $1 ORDER BY created_at`,
    [runId],
  );
  return rows;
}

async function waitingBuilder(conversationId: string, runId: string): Promise<Child> {
  return eventually(async () => {
    const detail = await getConversationDetail(t.db, conversationId);
    const pending = detail?.approvals.some((approval) => approval.status === 'pending');
    const builder = (await children(runId)).find((child) => child.role === 'builder');
    return pending && builder?.status === 'awaiting_approval' ? builder : null;
  }, 60_000);
}

async function streamedText(runId: string): Promise<string> {
  const { rows } = await t.db.query<{ delta: string }>(
    `SELECT payload->>'delta' AS delta FROM run_events
     WHERE run_id = $1 AND type = 'TEXT_MESSAGE_CONTENT' ORDER BY seq`,
    [runId],
  );
  return rows.map((row) => row.delta).join('');
}

async function memberMessage(id: string) {
  const { rows } = await t.db.query<{ status: string; delivered_run_id: string | null }>(
    'SELECT status, delivered_run_id FROM member_messages WHERE id = $1',
    [id],
  );
  return rows[0];
}

async function topRuns(conversationId: string) {
  const { rows } = await t.db.query<{
    id: string;
    user_message_id: string;
    status: string;
    source: string | null;
    start_as: string | null;
  }>(
    `SELECT id, user_message_id, status, source, start_as FROM runs
     WHERE conversation_id = $1 AND parent_run_id IS NULL ORDER BY created_at`,
    [conversationId],
  );
  return rows;
}

async function answerPending(conversationId: string) {
  const detail = await getConversationDetail(t.db, conversationId);
  for (const approval of detail?.approvals ?? []) {
    if (approval.status !== 'pending') continue;
    const decision = answerEverything(approval);
    if (!decision) continue;
    await decideApproval(t.db, t.workspaceId, approval.id, {
      scope: 'once',
      ...decision,
    }).catch((error: unknown) => {
      if (!(error instanceof ApprovalConflictError)) throw error;
    });
  }
}

async function settle(conversationId: string) {
  return eventually(async () => {
    const runs = await topRuns(conversationId);
    const busy = runs.some((run) =>
      ['queued', 'running', 'awaiting_approval'].includes(run.status),
    );
    if (!busy) return runs;
    await answerPending(conversationId);
    return null;
  }, 90_000);
}

function startManual(options: { agentEnv?: Record<string, string> } = {}) {
  harness = startOrchestrator(t, jevFetch({ calls: [], scenario: NORMAL }), {
    sessions,
    ...options,
  });
  return startScenario(t, root, NORMAL, 'hands-off', 'auto', 'sonnet', 'default');
}

describe('messaging a crew member', { timeout: 150_000 }, () => {
  it('delivers a message to a working Builder at its next turn boundary, in its own session', async () => {
    const { conversationId, runId } = await startManual();
    const builder = await waitingBuilder(conversationId, runId);
    const id = randomUUID();
    const sent = await post(`/api/runs/${builder.id}/messages`, {
      id,
      text: 'Also log the date you parse.',
    });
    expect(sent.status).toBe(202);
    expect(sent.body).toMatchObject({
      queued: false,
      message: { id, runId: builder.id, status: 'queued', urgency: 'next' },
    });
    expect(sent.body.reply).toBe(`Sent to ${builder.name}. It reads this at its next step.`);
    const again = await post(`/api/runs/${builder.id}/messages`, {
      id,
      text: 'Also log the date you parse.',
    });
    expect(again.body.message.id).toBe(id);

    const { orchestration } = await driveToEnd(t, conversationId, runId, answerEverything, 90_000);
    expect(orchestration.status).toBe('succeeded');
    expect(await memberMessage(id)).toMatchObject({
      status: 'delivered',
      delivered_run_id: builder.id,
    });
    const text = await streamedText(builder.id);
    expect(text).toContain('## Message from the user\nAlso log the date you parse.');
    const detail = await getConversationDetail(t.db, conversationId);
    expect(detail?.memberMessages).toEqual([
      expect.objectContaining({ id, runId: builder.id, status: 'delivered' }),
    ]);
  });

  it('refuses a finished member without Continue, then Continue resumes the Builder in a new turn', async () => {
    const { conversationId, runId } = await startManual();
    await driveToEnd(t, conversationId, runId, answerEverything, 90_000);
    const builder = (await children(runId)).find((child) => child.role === 'builder')!;
    const refused = await post(`/api/runs/${builder.id}/messages`, {
      id: randomUUID(),
      text: 'One more thing',
    });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe(
      `${builder.name} has finished. Continue ${builder.name} to pick its work back up.`,
    );

    const id = randomUUID();
    const continued = await post(`/api/runs/${builder.id}/messages`, {
      id,
      text: 'Also cover the leap day. #build',
      continue: true,
    });
    expect(continued.status).toBe(202);
    expect(continued.body).toMatchObject({
      queued: false,
      message: { id, status: 'continued', messageId: id },
    });
    const runs = await topRuns(conversationId);
    const next = runs.find((run) => run.user_message_id === id)!;
    expect(next.start_as).toBe('continue');
    await driveToEnd(t, conversationId, next.id, answerEverything, 90_000);
    const again = (await children(next.id)).find((child) => child.role === 'builder')!;
    expect(again.name).toBe(builder.name);
    const { rows } = await t.db.query<{ session_id: string }>(
      `SELECT DISTINCT session_id FROM provider_sessions
       WHERE conversation_id = $1 AND agent_key LIKE 'key:%builder%'`,
      [conversationId],
    );
    expect(rows).toHaveLength(1);
  });
});

describe('the chat queue', { timeout: 150_000 }, () => {
  it('keeps order, edits and removals, then sends each message after the turn ends', async () => {
    const { conversationId, runId } = await startManual();
    await waitingBuilder(conversationId, runId);
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    for (const [index, id] of ids.entries()) {
      const added = await post(`/api/conversations/${conversationId}/queue`, {
        id,
        content: `Queued ${index + 1}`,
      });
      expect(added.status).toBe(201);
    }
    await post(`/api/conversations/${conversationId}/queue`, { id: ids[0], content: 'Queued 1' });
    const app = api();
    const reordered = await request(app)
      .put(`/api/conversations/${conversationId}/queue/order`)
      .set(LOCAL_HEADERS)
      .set('Origin', ORIGIN)
      .send({ ids: [ids[2], ids[0], ids[1]] });
    expect(reordered.body.queue.map((item: { id: string }) => item.id)).toEqual([
      ids[2],
      ids[0],
      ids[1],
    ]);
    const edited = await request(app)
      .patch(`/api/conversations/${conversationId}/queue/${ids[2]}`)
      .set(LOCAL_HEADERS)
      .set('Origin', ORIGIN)
      .send({ content: 'Queued 3, edited' });
    expect(edited.body.queue[0]).toMatchObject({ id: ids[2], content: 'Queued 3, edited' });
    const removed = await request(app)
      .delete(`/api/conversations/${conversationId}/queue/${ids[1]}`)
      .set(LOCAL_HEADERS)
      .set('Origin', ORIGIN)
      .send({});
    expect(removed.body.queue.map((item: { id: string }) => item.id)).toEqual([ids[2], ids[0]]);
    const detail = await getConversationDetail(t.db, conversationId);
    expect(detail?.queue?.map((item) => item.content)).toEqual(['Queued 3, edited', 'Queued 1']);

    const runs = await eventually(async () => {
      const settled = await settle(conversationId);
      return settled.length === 3 ? settled : null;
    }, 120_000);
    expect(runs.map((run) => run.user_message_id).slice(1)).toEqual([ids[2], ids[0]]);
    expect(runs.slice(1).map((run) => run.source)).toEqual(['queue', 'queue']);
    expect((await getConversationDetail(t.db, conversationId))?.queue).toEqual([]);
  });

  it('Send now interrupts a turn whose agent cannot steer and sends the message first', async () => {
    const { conversationId, runId } = await startManual();
    await waitingBuilder(conversationId, runId);
    const later = randomUUID();
    const now = randomUUID();
    await post(`/api/conversations/${conversationId}/queue`, { id: later, content: 'Later' });
    await post(`/api/conversations/${conversationId}/queue`, { id: now, content: 'Right now' });
    const steered = await post(`/api/conversations/${conversationId}/queue/${now}/send-now`, {});
    expect(steered.status).toBe(202);
    expect(steered.body).toMatchObject({ outcome: 'steering', queue: [{ id: later }] });

    await eventually(async () => (await memberMessage(now))?.status !== 'queued', 30_000);
    const runs = await eventually(async () => {
      const settled = await settle(conversationId);
      return settled.length === 3 ? settled : null;
    }, 120_000);
    expect(runs.map((run) => run.status)).toEqual(['cancelled', 'succeeded', 'succeeded']);
    expect(runs.slice(1).map((run) => run.user_message_id)).toEqual([now, later]);
    expect(await memberMessage(now)).toMatchObject({ status: 'sent' });
  });

  it('stays paused after you stop the turn', async () => {
    const { conversationId, runId } = await startManual();
    await waitingBuilder(conversationId, runId);
    const id = randomUUID();
    await post(`/api/conversations/${conversationId}/queue`, { id, content: 'Later' });
    expect((await post(`/api/runs/${runId}/cancel`, {})).status).toBeLessThan(300);
    await eventually(async () => (await topRuns(conversationId))[0]?.status === 'cancelled');
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    expect(await settle(conversationId)).toHaveLength(1);
    const detail = await getConversationDetail(t.db, conversationId);
    expect(detail?.queue?.map((item) => item.id)).toEqual([id]);
    const sent = await post(`/api/conversations/${conversationId}/queue/${id}/send-now`, {});
    expect(sent.body).toMatchObject({ outcome: 'sent', queue: [] });
    expect((await topRuns(conversationId)).at(-1)?.user_message_id).toBe(id);
  });

  it('Send now steers the running turn when the agent supports steering', async () => {
    const { conversationId, runId } = await startManual({ agentEnv: { FAKE_ACP_STEERING: '1' } });
    const builder = await waitingBuilder(conversationId, runId);
    const id = randomUUID();
    await post(`/api/conversations/${conversationId}/queue`, { id, content: 'Use UTC.' });
    await post(`/api/conversations/${conversationId}/queue/${id}/send-now`, {});
    await eventually(async () => (await memberMessage(id))?.status === 'delivered', 30_000);
    expect(await memberMessage(id)).toMatchObject({ delivered_run_id: builder.id });
    const steered = await getConversationDetail(t.db, conversationId);
    expect(steered?.memberMessages?.find((message) => message.id === id)).toMatchObject({
      runId,
      deliveredRunId: builder.id,
    });
    const { orchestration } = await driveToEnd(t, conversationId, runId, answerEverything, 90_000);
    expect(orchestration.status).toBe('succeeded');
  });
});

describe('Send now from the composer', { timeout: 150_000 }, () => {
  const sendNow = (conversationId: string, body: object) =>
    post(`/api/conversations/${conversationId}/queue/send-now`, body);

  async function stored(id: string) {
    const { rows } = await t.db.query<{ messages: number; notes: number; queued: number }>(
      `SELECT (SELECT count(*)::int FROM messages WHERE id = $1) AS messages,
         (SELECT count(*)::int FROM member_messages WHERE id = $1) AS notes,
         (SELECT count(*)::int FROM chat_queue WHERE id = $1) AS queued`,
      [id],
    );
    return rows[0];
  }

  it('stops a turn whose agent cannot steer, sends the message first and keeps the queue in order', async () => {
    const { conversationId, runId } = await startManual();
    await waitingBuilder(conversationId, runId);
    const [first, second, now] = [randomUUID(), randomUUID(), randomUUID()];
    await post(`/api/conversations/${conversationId}/queue`, { id: first, content: 'First' });
    await post(`/api/conversations/${conversationId}/queue`, { id: second, content: 'Second' });
    const sent = await sendNow(conversationId, { id: now, content: 'Right now' });
    expect(sent.status).toBe(202);
    expect(sent.body).toMatchObject({
      outcome: 'steering',
      queue: [{ id: first }, { id: second }],
    });
    const again = await sendNow(conversationId, { id: now, content: 'Right now' });
    expect(again.body).toMatchObject({
      outcome: 'steering',
      queue: [{ id: first }, { id: second }],
    });
    expect(await stored(now)).toEqual({ messages: 0, notes: 1, queued: 0 });

    await eventually(async () => (await memberMessage(now))?.status !== 'queued', 30_000);
    const runs = await eventually(async () => {
      await answerPending(conversationId);
      const started = await topRuns(conversationId);
      return started.length >= 3 ? started : null;
    }, 120_000);
    expect(runs[0]?.status).toBe('cancelled');
    expect(runs.slice(1, 3).map((run) => run.user_message_id)).toEqual([now, first]);
    const waiting = (await getConversationDetail(t.db, conversationId))?.queue ?? [];
    expect([
      ...runs.slice(3).map((run) => run.user_message_id),
      ...waiting.map((item) => item.id),
    ]).toEqual([second]);
    await settle(conversationId);
    expect(await memberMessage(now)).toMatchObject({ status: 'sent' });
    expect(await stored(now)).toEqual({ messages: 1, notes: 1, queued: 0 });
  });

  it('steers a running turn whose agent supports it, without a turn of its own', async () => {
    const { conversationId, runId } = await startManual({ agentEnv: { FAKE_ACP_STEERING: '1' } });
    const builder = await waitingBuilder(conversationId, runId);
    const later = randomUUID();
    const now = randomUUID();
    await post(`/api/conversations/${conversationId}/queue`, { id: later, content: 'Later' });
    const sent = await sendNow(conversationId, { id: now, content: 'Use UTC.' });
    expect(sent.body).toMatchObject({ outcome: 'steering', queue: [{ id: later }] });
    await eventually(async () => (await memberMessage(now))?.status === 'delivered', 30_000);
    expect(await memberMessage(now)).toMatchObject({ delivered_run_id: builder.id });

    const runs = await eventually(async () => {
      const settled = await settle(conversationId);
      return settled.length === 2 ? settled : null;
    }, 120_000);
    expect(runs.map((run) => run.status)).toEqual(['succeeded', 'succeeded']);
    expect(runs.map((run) => run.user_message_id)).not.toContain(now);
    expect(runs[1]?.user_message_id).toBe(later);

    const repeated = await sendNow(conversationId, { id: now, content: 'Use UTC.' });
    expect(repeated.status).toBe(202);
    expect(await topRuns(conversationId)).toHaveLength(2);
    expect(await stored(now)).toEqual({ messages: 0, notes: 1, queued: 0 });
  });

  it('sends straight away when no turn is running, ahead of a paused queue', async () => {
    const { conversationId, runId } = await startManual();
    await waitingBuilder(conversationId, runId);
    const later = randomUUID();
    await post(`/api/conversations/${conversationId}/queue`, { id: later, content: 'Later' });
    await post(`/api/runs/${runId}/cancel`, {});
    await eventually(async () => (await topRuns(conversationId))[0]?.status === 'cancelled');
    const now = randomUUID();
    const sent = await sendNow(conversationId, { id: now, content: 'Go on with this' });
    expect(sent.body).toMatchObject({ outcome: 'sent', queue: [{ id: later }] });
    await sendNow(conversationId, { id: now, content: 'Go on with this' });
    const runs = await topRuns(conversationId);
    expect(runs.map((run) => run.user_message_id).slice(1)).toEqual([now]);
    expect(await stored(now)).toEqual({ messages: 1, notes: 0, queued: 0 });
    await post(`/api/runs/${runs[1]!.id}/cancel`, {});
    await eventually(async () => (await topRuns(conversationId))[1]?.status === 'cancelled');
  });

  it('stores nothing when the request is refused', async () => {
    const { conversationId, runId } = await startManual();
    await waitingBuilder(conversationId, runId);
    const id = randomUUID();
    expect((await sendNow(conversationId, { id, content: '   ' })).status).toBe(400);
    expect((await sendNow(conversationId, { id: 'nope', content: 'Hello' })).status).toBe(400);
    expect((await sendNow(randomUUID(), { id, content: 'Hello' })).status).toBe(404);
    expect(await stored(id)).toEqual({ messages: 0, notes: 0, queued: 0 });
    const detail = await getConversationDetail(t.db, conversationId);
    expect(detail?.memberMessages).toEqual([]);
    expect(await settle(conversationId)).toHaveLength(1);
  });

  it('keeps a message whose turn died with its worker and sends it once, before the queue', async () => {
    const { conversationId, runId } = await startScenario(
      t,
      root,
      NORMAL,
      'hands-off',
      'auto',
      'sonnet',
      'default',
    );
    await t.db.query(`UPDATE runs SET status = 'running' WHERE id = $1`, [runId]);
    await t.db.query(
      `UPDATE jobs SET status = 'leased', attempts = 1, lease_token = $2,
         lease_expires_at = now() - interval '1 minute' WHERE run_id = $1`,
      [runId, randomUUID()],
    );
    const later = randomUUID();
    const now = randomUUID();
    await post(`/api/conversations/${conversationId}/queue`, { id: later, content: 'Later' });
    const sent = await sendNow(conversationId, { id: now, content: 'Right now' });
    expect(sent.body).toMatchObject({ outcome: 'steering', queue: [{ id: later }] });
    expect(await memberMessage(now)).toMatchObject({ status: 'queued' });

    harness = startOrchestrator(t, jevFetch({ calls: [], scenario: NORMAL }), { sessions });
    await eventually(async () => (await memberMessage(now))?.status === 'sent', 120_000);
    const runs = await eventually(async () => {
      const settled = await settle(conversationId);
      return settled.some((run) => run.user_message_id === now && run.status === 'succeeded')
        ? settled
        : null;
    }, 120_000);
    expect(runs[1]?.user_message_id).toBe(now);
    expect(runs.filter((run) => run.user_message_id === now)).toHaveLength(1);
    const waiting = (await getConversationDetail(t.db, conversationId))?.queue ?? [];
    expect([
      ...runs.slice(2).map((run) => run.user_message_id),
      ...waiting.map((item) => item.id),
    ]).toEqual([later]);
    expect(await stored(now)).toEqual({ messages: 1, notes: 1, queued: 0 });
  });
});
