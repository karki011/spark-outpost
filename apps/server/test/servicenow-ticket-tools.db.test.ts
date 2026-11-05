import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { memorySecretStore, type SecretStore } from '../src/setup/secrets.ts';
import { saveConnection } from '../src/tickets/connections.ts';
import { SERVICENOW_PASSWORD, SERVICENOW_USER } from './fake-servicenow.ts';
import {
  confirmCard,
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
let tools: SparkToolsHarness;

beforeEach(async () => {
  t = await createTestDb();
  secrets = memorySecretStore();
  stubs = await startTicketStubs();
  await saveConnection(
    { db: t.db, workspaceId: t.workspaceId, secrets, fetch },
    {
      source: 'servicenow',
      instanceUrl: stubs.serviceNowUrl,
      authKind: 'basic',
      username: SERVICENOW_USER,
      password: SERVICENOW_PASSWORD,
    },
  );
  const { conversationId, runId } = await startChat(t, 'Look into the VPN drops');
  recorded = recordedHooks();
  tools = await startSparkTools(t, { conversationId, runId, actions: recorded.hooks }, { secrets });
});

afterEach(async () => {
  recorded.stop();
  await tools.close();
  await stubs.close();
  await t.cleanup();
});

async function cardCount() {
  const { rows } = await t.db.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM approvals WHERE kind = 'spark_action'`,
  );
  return rows[0]!.count;
}

describe('the generic ticket tools on ServiceNow', () => {
  it('posts spark_comment_ticket as a work note, never a comment the caller sees', async () => {
    await tools.call('spark_comment_ticket', { key: 'INC0010023', body: 'Root cause found.' });
    const card = await confirmCard(t);
    expect(card.payload.sparkResult).toMatchObject({ state: 'done' });
    expect(stubs.servicenow.writes.map((write) => write.body)).toEqual([
      { work_notes: 'Root cause found.' },
    ]);
  });

  it('refuses to resolve, close or cancel with spark_transition_ticket, without a card', async () => {
    for (const status of ['Resolved', 'done', 'Canceled', 'in_review']) {
      const result = (
        await tools.call('spark_transition_ticket', { key: 'INC0010023', status })
      ).json<{ outcome: string; message: string }>();
      expect(result.outcome).toBe('refused');
      expect(result.message).toContain('resolving, closing or cancelling tells the caller');
    }
    expect(await cardCount()).toBe(0);
    expect(stubs.servicenow.writes).toEqual([]);
  });

  it('moves to a state that is not final after the card', async () => {
    await tools.call('spark_transition_ticket', { key: 'INC0010023', status: 'On Hold' });
    await confirmCard(t);
    expect(stubs.servicenow.writes.map((write) => write.body)).toEqual([{ state: '3' }]);
  });

  it('refuses to create a ServiceNow record and keeps changes read only', async () => {
    const created = await tools.call('spark_create_ticket', { project: 'incident', title: 'New' });
    expect(created.isError).toBe(true);
    expect(created.text).toContain('ServiceNow records are opened in ServiceNow');
    const change = await tools.call('spark_comment_ticket', { key: 'CHG0030012', body: 'x' });
    expect(change.isError).toBe(true);
    expect(change.text).toContain('Changes are read only in Spark');
    expect(await cardCount()).toBe(0);
  });
});
