import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ConversationDetail, Orchestration } from '@spark-outpost/contracts';
import { insertPlanDocument } from '../src/persistence/plan-documents.ts';
import { createTestApp, localClient } from './app-support.ts';
import { seedAccept, seedConversation, seedTask, seedTurn } from './outcome-seed.ts';
import { storeHelper, storePieceList, storeReply } from './stored-crew-turn.ts';
import { createTestDb, type TestDb } from './support.ts';

const REQUEST = 'Move the date helpers into one module';
const PLAN = '## Plan\n- [ ] Move the helpers\n- [ ] Update the callers';

let t: TestDb;
let client: ReturnType<typeof localClient>;

beforeEach(async () => {
  t = await createTestDb();
  client = localClient(createTestApp(t));
});

afterEach(async () => {
  await t.cleanup();
});

async function storedCrewTurn() {
  const conversationId = await seedConversation(t.db, t.workspaceId);
  const taskId = await seedTask(t.db, conversationId);
  const runId = await seedTurn(t.db, conversationId, { taskId, request: REQUEST, intake: true });
  await t.db.query('UPDATE runs SET cost_usd = 0.05 WHERE id = $1', [runId]);
  const builderId = await storeHelper(t.db, runId, {
    role: 'builder',
    name: 'Bolt',
    provider: 'claude',
    model: 'sonnet',
    status: 'succeeded',
    costUsd: 0.4,
    reply: 'Moved the helpers into dates.ts.',
    route: { routedBy: 'jev', pieceKey: 'P1' },
  });
  const criticId = await storeHelper(t.db, runId, {
    role: 'critic',
    name: 'Hawk',
    provider: 'codex',
    model: 'gpt-5',
    status: 'succeeded',
    costUsd: 0.1,
    reply: 'No concerns.',
  });
  const finalId = await storeReply(t.db, runId, 'Done: the date helpers live in dates.ts.');
  await storePieceList(t.db, {
    taskId,
    orchestrationRunId: runId,
    placementReason: 'Pieces touch different files.',
    pieces: [
      {
        key: 'P1',
        title: 'Move the helpers',
        owns: ['src/dates.ts'],
        provider: 'claude',
        model: 'sonnet',
        status: 'landed',
        builderRunId: builderId,
      },
    ],
  });
  await seedAccept(t.db, runId, 'keep');
  await insertPlanDocument(t.db, {
    conversationId,
    taskId,
    source: 'chat',
    body: PLAN,
    sourceRunId: runId,
    approval: { by: 'jev', option: 'build_pieces', runId, commit: null },
  });
  return { conversationId, runId, builderId, criticId, finalId };
}

describe('a crew turn stored by an earlier version', { timeout: 30_000 }, () => {
  it('still loads through the API with its transcript, helper replies, costs, cards and plan', async () => {
    const turn = await storedCrewTurn();
    const before = await rowCounts();

    const chat = await client.get(`/api/conversations/${turn.conversationId}`);
    const one = await client.get(`/api/runs/${turn.runId}/orchestration`);

    expect(chat.status).toBe(200);
    const detail = chat.body as ConversationDetail;
    expect(
      detail.messages.map((message) => [message.role, message.runId, message.content]),
    ).toEqual([
      ['user', null, REQUEST],
      ['assistant', turn.builderId, 'Moved the helpers into dates.ts.'],
      ['assistant', turn.criticId, 'No concerns.'],
      ['assistant', turn.runId, 'Done: the date helpers live in dates.ts.'],
    ]);
    expect(detail.runs.map((run) => run.id)).toEqual([turn.runId]);
    const stored = detail.orchestrations![turn.runId]!;
    expect(
      stored.crew.map((member) => [member.name, member.role, member.model, member.costUsd]),
    ).toEqual([
      ['Bolt', 'builder', 'sonnet', 0.4],
      ['Hawk', 'critic', 'gpt-5', 0.1],
    ]);
    expect(stored.totals).toMatchObject({ runs: 2, costUsd: 0.5 });
    expect(
      stored.checkpoints.map((card) => [card.kind, card.status, card.decisionOptionId]),
    ).toEqual([['accept', 'allowed', 'keep']]);
    expect(detail.approvals.map((card) => card.kind)).toEqual(['accept']);
    expect(detail.plans?.lines).toEqual([
      { runId: turn.runId, version: 1, items: 2, unit: 'pieces' },
    ]);
    expect(detail.usageTotals?.costUsd).toBeCloseTo(0.55, 6);

    expect(one.status).toBe(200);
    expect((one.body as Orchestration).crew.map((member) => member.runId)).toEqual([
      turn.builderId,
      turn.criticId,
    ]);
    expect(await rowCounts()).toEqual(before);
  });

  it('has no route that lists, changes or messages the pieces of a stored turn', async () => {
    const turn = await storedCrewTurn();
    const { rows } = await t.db.query<{ task_id: string }>(
      'SELECT task_id FROM runs WHERE id = $1',
      [turn.runId],
    );
    const taskId = rows[0]!.task_id;

    const list = await client.get(`/api/tasks/${taskId}/pieces`);
    const steer = await client.send('post', `/api/tasks/${taskId}/steer`, {
      id: randomUUID(),
      text: 'Also rename it',
    });
    const message = await client.send('post', `/api/runs/${turn.builderId}/messages`, {
      id: randomUUID(),
      text: 'Keep going',
      continue: true,
    });

    expect(list.status).toBe(404);
    expect(steer.status).toBe(404);
    expect(message.status).toBe(404);
  });
});

async function rowCounts(): Promise<Record<string, number>> {
  const { rows } = await t.db.query<{ name: string; count: number }>(
    `SELECT 'runs' AS name, count(*)::int AS count FROM runs
     UNION ALL SELECT 'orchestrations', count(*)::int FROM orchestrations
     UNION ALL SELECT 'run_advice', count(*)::int FROM run_advice
     UNION ALL SELECT 'task_pieces', count(*)::int FROM task_pieces
     UNION ALL SELECT 'member_messages', count(*)::int FROM member_messages`,
  );
  return Object.fromEntries(rows.map((row) => [row.name, row.count]));
}
