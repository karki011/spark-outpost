import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EventType, type PieceList } from '@spark-outpost/contracts';
import { listQueue } from '../src/persistence/chat-queue.ts';
import { getMemberMessage, insertMemberMessage } from '../src/persistence/member-messages.ts';
import { loadOrchestration } from '../src/persistence/orchestrations.ts';
import { pendingPieceNotes } from '../src/persistence/piece-notes.ts';
import { currentPieceList } from '../src/persistence/pieces.ts';
import { getRun, requestCancel } from '../src/persistence/runs.ts';
import { chatTarget, drainQueue, sendNow, waitingQueues } from '../src/workflow/queue-drain.ts';
import { expectConformantRun, storedEvents } from './agui-conformance.ts';
import { pieceRepo, projectFlags } from './coordinator-parallel-support.ts';
import {
  connectProviders,
  gitRepo,
  NORMAL,
  removeRepo,
  startOrchestrator,
  startScenario,
  withTag,
  type Harness,
} from './orchestration-support.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

let t: TestDb;
let root: string;
let harness: Harness;
let conversationId: string;
let runId: string;

async function pieces(): Promise<PieceList | null> {
  const taskId = (await loadOrchestration(t.db, runId))?.taskId;
  return taskId ? currentPieceList(t.db, taskId) : null;
}

async function statuses(): Promise<Record<string, string>> {
  const list = await pieces();
  return Object.fromEntries((list?.pieces ?? []).map((piece) => [piece.key, piece.status]));
}

async function send(content: string): Promise<string> {
  const id = randomUUID();
  expect(await sendNow(t.db, conversationId, { id, content }, chatTarget(t.db))).toBe('steering');
  return id;
}

async function routed(id: string): Promise<void> {
  await eventually(async () => {
    const { rowCount } = await t.db.query(
      `SELECT 1 FROM run_advice WHERE run_id = $1 AND body ? 'midBuild'`,
      [runId],
    );
    const message = await getMemberMessage(t.db, id);
    return message?.status !== 'queued' && (rowCount ?? 0) > 0;
  }, 30_000);
}

beforeEach(async () => {
  t = await createTestDb();
  root = await gitRepo();
  await pieceRepo(root);
  await connectProviders(t);
  await projectFlags(t, root, { parallel: true });
  harness = startOrchestrator(t, null, { coordinator: 'parallel' });
  const scenario = withTag(NORMAL, 'Split this up. #pieces #parallel #slowpieces');
  const started = await startScenario(
    t,
    root,
    scenario,
    'hands-off',
    'auto',
    'sonnet',
    'acceptEdits',
  );
  conversationId = started.conversationId;
  runId = started.runId;
  await eventually(async () => {
    const now = await statuses();
    return now.P1 === 'running' && now.P2 === 'running';
  }, 60_000);
});

afterEach(async () => {
  await requestCancel(t.db, runId);
  await eventually(async () => (await getRun(t.db, runId))?.finishedAt, 45_000);
  await harness.stop();
  await t.cleanup();
  await removeRepo(root);
}, 60_000);

describe('a message sent while pieces build', { timeout: 120_000 }, () => {
  it('answers a question on the conversation session without stopping a worker', async () => {
    const id = await send('What is P2 doing right now?');
    expect((await getMemberMessage(t.db, id))?.urgency ?? 'next').toBe('next');
    await routed(id);
    const answered = await eventually(async () => {
      const { rows } = await t.db.query<{ id: string; status: string; mode: string }>(
        `SELECT id, status, mode FROM runs
         WHERE parent_run_id = $1 AND role = 'scout' AND route->>'resumeKey' LIKE '%:conversation'`,
        [runId],
      );
      return rows[0]?.status === 'succeeded' ? rows[0] : null;
    }, 30_000);
    expect(answered.mode).toBe('ask');
    const { rows: sessions } = await t.db.query<{ key: string }>(
      `SELECT body->>'agentKey' AS key FROM provider_session_events WHERE run_id = $1`,
      [answered.id],
    );
    expect(sessions.map((row) => row.key)).toContain('chat:claude');
    expect((await getMemberMessage(t.db, id))?.deliveredRunId).toBe(answered.id);
    expect(await statuses()).toMatchObject({ P1: 'running', P2: 'running' });
    const own = await storedEvents(t.db, answered.id);
    expect(own[0]).toMatchObject({ type: EventType.RUN_STARTED, parentRunId: runId });
    const inChat = (await storedEvents(t.db, runId)).filter(
      (event) => (event as { subagentRunId?: string }).subagentRunId === answered.id,
    );
    expect(inChat.map((event) => event.type)).toEqual([
      EventType.SUBAGENT_STARTED,
      EventType.TEXT_MESSAGE_START,
      ...inChat.slice(2, -2).map(() => EventType.TEXT_MESSAGE_CONTENT),
      EventType.TEXT_MESSAGE_END,
      EventType.SUBAGENT_FINISHED,
    ]);
    expect(inChat[0]).toMatchObject({ name: 'conversation', parentMessageId: id });
    expect(inChat.length).toBeGreaterThan(4);
    const view = await loadOrchestration(t.db, runId);
    expect(view?.answers?.map((member) => [member.runId, member.answers])).toEqual([
      [answered.id, id],
    ]);
    expect(view?.crew.some((member) => member.runId === answered.id)).toBe(false);
    await requestCancel(t.db, runId);
    await eventually(async () => (await getRun(t.db, runId))?.finishedAt, 45_000);
    await expectConformantRun(t.db, runId);
  });

  it('gives an added requirement to the worker on that file, or to the brief of one not started', async () => {
    await routed(await send('Also make sure store.ts trims the names'));
    await send('Also make view.ts show the tag count');
    await eventually(async () => {
      const now = await pieces();
      const waiting = now?.pieces.find((entry) => entry.key === 'P3');
      return waiting?.acceptance.includes('Also make view.ts show the tag count');
    }, 30_000);
    const list = (await pieces())!;
    const piece = (key: string) => list.pieces.find((entry) => entry.key === key)!;
    expect(piece('P1').acceptance).toContain('Also make sure store.ts trims the names');
    expect(piece('P3').acceptance).toContain('Also make view.ts show the tag count');
    expect((await pendingPieceNotes(t.db, piece('P3').id)).map((note) => note.kind)).toEqual([
      'requirement_added',
    ]);
    expect(await statuses()).toMatchObject({ P1: 'running', P2: 'running', P3: 'pending' });
  });

  it('sends a message stored as the last piece lands as the next chat message', async () => {
    await requestCancel(t.db, runId);
    await eventually(async () => (await getRun(t.db, runId))?.finishedAt, 45_000);
    const id = randomUUID();
    await insertMemberMessage(t.db, {
      id,
      conversationId,
      runId,
      body: 'What changed in store.ts?',
      urgency: 'next',
    });
    expect(await waitingQueues(t.db)).toContain(conversationId);
    await eventually(async () => {
      await drainQueue(t.db, conversationId, chatTarget(t.db));
      return (await getMemberMessage(t.db, id))?.status === 'sent';
    }, 30_000);
    const { rows } = await t.db.query<{ content: string }>(
      'SELECT content FROM messages WHERE id = $1',
      [id],
    );
    expect(rows).toEqual([{ content: 'What changed in store.ts?' }]);
  });

  it('queues unrelated work as the next message', async () => {
    const id = await send('Rename the repo to tiny-maths');
    await eventually(async () => (await getMemberMessage(t.db, id))?.status === 'sent', 30_000);
    expect((await listQueue(t.db, conversationId)).map((item) => item.id)).toEqual([id]);
    expect(await statuses()).toMatchObject({ P1: 'running', P2: 'running' });
  });
});
