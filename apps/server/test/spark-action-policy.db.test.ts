import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Approval } from '@spark-outpost/contracts';
import { getApproval } from '../src/persistence/approvals.ts';
import type { RunObservations } from '../src/observations/run-observations.ts';
import { memorySecretStore, type SecretStore } from '../src/setup/secrets.ts';
import { saveConnection as saveTicketConnection } from '../src/tickets/connections.ts';
import { LINEAR_KEY } from './fake-linear.ts';
import {
  confirmCard,
  fullAutoChat,
  recordedHooks,
  startSparkTools,
  type RecordedHooks,
  type SparkToolsHarness,
} from './spark-mcp-support.ts';
import { createTestDb, startChat, type TestDb } from './support.ts';
import { startTicketStubs, type TicketStubs } from './ticket-support.ts';

let t: TestDb;
let secrets: SecretStore;
let stubs: TicketStubs;
let recorded: RecordedHooks;
let tools: SparkToolsHarness | null = null;

beforeEach(async () => {
  t = await createTestDb();
  secrets = memorySecretStore();
  stubs = await startTicketStubs();
  await saveTicketConnection(
    { db: t.db, workspaceId: t.workspaceId, secrets, fetch, linearApiUrl: stubs.linearUrl },
    { source: 'linear', apiKey: LINEAR_KEY },
  );
  recorded = recordedHooks();
});

afterEach(async () => {
  recorded.stop();
  await tools?.close();
  tools = null;
  await stubs.close();
  await t.cleanup();
});

const secretRead: RunObservations = {
  record: () => undefined,
  labels: async () => ['a secret file'],
  egressAsked: () => undefined,
  settled: async () => undefined,
};

interface ChatPlace {
  observations?: RunObservations;
  level?: 'full-auto';
}

async function chatIn(message: string, mode: string | null, place: ChatPlace = {}) {
  const { conversationId, runId } = await startChat(t, message);
  if (place.level) await fullAutoChat(t, conversationId);
  if (mode) {
    await t.db.query(`UPDATE runs SET provider = 'claude', used_mode = $2 WHERE id = $1`, [
      runId,
      mode,
    ]);
  }
  tools = await startSparkTools(
    t,
    { conversationId, runId, actions: recorded.hooks, observations: place.observations },
    { secrets, linearApiUrl: stubs.linearUrl },
  );
}

async function createTicket() {
  return (
    await tools!.call('spark_create_ticket', { project: 'ENG', title: 'Crash on save' })
  ).json<{
    outcome: string;
    approvalId?: string;
    message?: string | null;
  }>();
}

async function cardOf(result: { approvalId?: string }): Promise<Approval> {
  return (await getApproval(t.db, result.approvalId!))!;
}

describe('whether a Spark action asks first', () => {
  it('acts at once in Auto mode and shows what it did', async () => {
    await chatIn('Look into the crash', 'auto');
    const result = await createTicket();
    expect(result).toMatchObject({ outcome: 'done', message: 'Created ENG-105.' });
    expect(stubs.linear.issues.at(-1)).toMatchObject({ title: 'Crash on save' });
  });

  it('acts at once in Bypass permissions', async () => {
    await chatIn('Look into the crash', 'bypassPermissions');
    expect(await createTicket()).toMatchObject({ outcome: 'done' });
  });

  it('acts at once at Full auto → PR whatever the mode', async () => {
    await chatIn('Look into the crash', 'default', { level: 'full-auto' });
    expect(await createTicket()).toMatchObject({ outcome: 'done' });
  });

  it('acts in Accept edits only when the user asked for it', async () => {
    await chatIn('Please create a ticket for the crash', 'acceptEdits');
    expect(await createTicket()).toMatchObject({ outcome: 'done' });
    await tools!.close();
    await chatIn('Look into the crash', 'acceptEdits');
    expect(await createTicket()).toMatchObject({ outcome: 'waiting_for_user' });
  });

  it('shows a focused card in Manual mode even when the user asked for it', async () => {
    await chatIn('Please create a ticket for the crash', 'default');
    const before = stubs.linear.issues.length;
    const result = await createTicket();
    const card = await cardOf(result);

    expect(result).toMatchObject({ outcome: 'waiting_for_user' });
    expect(card).toMatchObject({ status: 'pending' });
    expect(card.payload.sparkRequested).toBe(true);
    expect(stubs.linear.issues).toHaveLength(before);

    const settled = await confirmCard(t);
    expect(settled.payload.sparkResult).toMatchObject({ state: 'done' });
  });

  it('asks first after the agent read a secret, even in Bypass permissions', async () => {
    await chatIn('Please create a ticket for the crash', 'bypassPermissions', {
      observations: secretRead,
    });
    const result = await createTicket();
    const card = await cardOf(result);
    expect(result).toMatchObject({ outcome: 'waiting_for_user' });
    expect(card.payload.observed).toEqual(['a secret file']);
  });

  it('reports a failure on the card and to the agent', async () => {
    await chatIn('Look into the crash', 'auto');
    const result = await tools!.call('spark_create_ticket', { project: 'NOPE', title: 'x' });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('Spark could not do it');
  });
});
