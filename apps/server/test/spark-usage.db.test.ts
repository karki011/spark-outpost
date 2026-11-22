import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  SparkUsage,
  Teammate,
  WorkflowRunSource,
  WorkflowUsage,
} from '@spark-outpost/contracts';
import { insertWorkflowRun } from '../src/crew-flows/run-records.ts';
import { sendUserMessage } from '../src/persistence/conversations.ts';
import { ROUTE_RULES } from '../src/remote/route-rules.ts';
import { createTestApp, localClient } from './app-support.ts';
import { newSpark, saveFlow, step, useWorkflowsDir } from './crew-workflow-support.ts';
import { connectCliProvider, createTestDb, startChat, type TestDb } from './support.ts';

let t: TestDb;
let client: ReturnType<typeof localClient>;
let dropWorkflows: () => Promise<void>;
let pip: Teammate;
let wren: Teammate;

beforeEach(async () => {
  t = await createTestDb();
  dropWorkflows = await useWorkflowsDir();
  client = localClient(createTestApp(t));
  await connectCliProvider(t, 'claude');
  pip = await newSpark(t, 'Pip');
  wren = await newSpark(t, 'Wren', { instructions: 'Hand risky changes to Pip first.' });
});

afterEach(async () => {
  await t.cleanup();
  await dropWorkflows();
});

async function spend(runId: string, tokens: number, costUsd: number | null) {
  await t.db.query(
    `UPDATE runs SET status = 'succeeded', input_tokens = $2, output_tokens = 0, cost_usd = $3
     WHERE id = $1`,
    [runId, tokens, costUsd],
  );
}

async function linkedChat(tokens: number, costUsd: number | null): Promise<string> {
  const conversationId = randomUUID();
  await client.send('put', `/api/conversations/${conversationId}/teammate`, {
    teammateId: pip.id,
  });
  const sent = await sendUserMessage(
    t.db,
    conversationId,
    { id: randomUUID(), content: 'Review my branch' },
    { provider: 'claude' },
  );
  await spend(sent.run.id, tokens, costUsd);
  return conversationId;
}

async function childRun(
  parentRunId: string,
  spark: Record<string, unknown>,
  tokens: number,
  costUsd: number | null,
): Promise<string> {
  const id = randomUUID();
  await t.db.query(
    `INSERT INTO runs (id, conversation_id, user_message_id, provider, status, parent_run_id,
       role, route, input_tokens, output_tokens, cost_usd)
     SELECT $1, conversation_id, user_message_id, provider, 'succeeded', id, 'spark', $3,
       $4, 0, $5
     FROM runs WHERE id = $2`,
    [id, parentRunId, JSON.stringify({ name: 'Pip', spark }), tokens, costUsd],
  );
  return id;
}

async function usageOf(sparkId: string): Promise<SparkUsage> {
  const response = await client.get(`/api/teammates/${sparkId}/usage`);
  expect(response.status).toBe(200);
  return response.body as SparkUsage;
}

async function flowRun(source: WorkflowRunSource, tokens: number, costUsd: number | null) {
  const chat = await startChat(t, `Run ${source}`);
  await spend(chat.runId, tokens, costUsd);
  await insertWorkflowRun(t.db, {
    id: randomUUID(),
    workspaceId: t.workspaceId,
    workflow: { id: 'risk-review', name: 'Risk review', steps: [step('look', pip.id)] },
    kind: 'run',
    source,
    conversationId: chat.conversationId,
    runId: chat.runId,
    message: 'Look at this',
    continues: false,
  });
  return chat;
}

describe('where a Spark is used', () => {
  it('lists the workflows whose steps name it and the Sparks whose instructions do', async () => {
    await saveFlow(t, 'risk-review', [
      step('scan', wren.id),
      step('judge', pip.id, { dependsOn: ['scan'] }),
    ]);
    await saveFlow(t, 'notes', [step('write', wren.id)]);

    const usage = await usageOf(pip.id);

    expect(usage.workflows).toEqual([
      { id: 'risk-review', name: 'Flow risk-review', steps: [2], stepCount: 2 },
    ]);
    expect(usage.sparks).toEqual([{ id: wren.id, name: 'Wren' }]);
    expect((await usageOf(wren.id)).sparks).toEqual([]);
  });

  it('counts linked chats with their spend, archived ones included', async () => {
    await linkedChat(100, 0.5);
    const archived = await linkedChat(50, 0.25);
    await t.db.query('UPDATE conversations SET archived_at = now() WHERE id = $1', [archived]);
    await client.send('put', `/api/conversations/${randomUUID()}/teammate`, {
      teammateId: pip.id,
    });

    const { chats, recent } = await usageOf(pip.id);

    expect(chats).toMatchObject({ count: 2, tokens: 150, costUsd: 0.75 });
    expect(chats.lastAt).not.toBeNull();
    expect(recent.map((entry) => entry.kind)).toEqual(['chat', 'chat']);
  });

  it('counts @Spark jobs and workflow steps apart and leaves test runs out', async () => {
    const chat = await startChat(t, '@Pip look at this');
    await childRun(chat.runId, { id: pip.id, role: 'Code reviewer', only: true }, 40, 0.1);
    await childRun(chat.runId, { id: pip.id, role: 'Code reviewer', only: true }, 60, null);
    await childRun(chat.runId, { id: pip.id, role: '', only: true, step: 'judge' }, 7, 0.02);
    await childRun(
      chat.runId,
      { id: pip.id, role: '', only: true, step: 'judge', test: true },
      9,
      1,
    );
    await childRun(chat.runId, { id: wren.id, role: '', only: true }, 500, 5);

    const usage = await usageOf(pip.id);

    expect(usage.jobs).toMatchObject({ count: 2, tokens: 100, costUsd: 0.1 });
    expect(usage.steps).toMatchObject({ count: 1, tokens: 7, costUsd: 0.02 });
    expect(usage.chats).toEqual({ count: 0, lastAt: null, tokens: 0, costUsd: null });
    expect(usage.recent.map((entry) => entry.kind).sort()).toEqual(['job', 'job', 'step']);
    expect(usage.recent[0]).toMatchObject({
      conversationId: chat.conversationId,
      status: 'succeeded',
    });
  });

  it('answers 404 for a deleted Spark', async () => {
    await client.send('delete', `/api/teammates/${pip.id}`);
    expect((await client.get(`/api/teammates/${pip.id}/usage`)).status).toBe(404);
  });
});

describe('where a workflow ran', () => {
  it('groups runs by how they started and names the chats they ran in', async () => {
    const manual = await flowRun('manual', 100, 0.5);
    await childRun(manual.runId, { id: pip.id, role: '', only: true, step: 'look' }, 20, 0.1);
    await flowRun('trigger', 10, null);
    await flowRun('trigger', 30, 0.2);

    const response = await client.get('/api/workflows/risk-review/usage');
    const usage = response.body as WorkflowUsage;

    expect(response.status).toBe(200);
    expect(usage.total).toMatchObject({ count: 3, tokens: 160 });
    expect(usage.total.costUsd).toBeCloseTo(0.8);
    expect(usage.sources.map(({ source, count, tokens }) => [source, count, tokens])).toEqual([
      ['trigger', 2, 40],
      ['manual', 1, 120],
    ]);
    expect(usage.chats).toHaveLength(3);
    expect(usage.chats.map((chat) => chat.runs)).toEqual([1, 1, 1]);
    expect(usage.chats.map((chat) => chat.conversationId)).toContain(manual.conversationId);
  });

  it('is empty for a workflow that never ran', async () => {
    const usage = (await client.get('/api/workflows/never-ran/usage')).body as WorkflowUsage;
    expect(usage).toEqual({
      total: { count: 0, lastAt: null, tokens: 0, costUsd: null },
      sources: [],
      chats: [],
    });
  });
});

describe('usage routes on a paired device', () => {
  it('stay on the Mac', () => {
    const rule = (line: string) => ROUTE_RULES.get(line);
    expect(rule('GET /api/teammates/:id/usage')).toBe('never');
    expect(rule('GET /api/workflows/:id/usage')).toBe('never');
    expect(rule('PUT /api/teammate-default')).toBe('never');
    expect(rule('POST /api/conversations/:id/default-teammate')).toBe('always');
  });
});
