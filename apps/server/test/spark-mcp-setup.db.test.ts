import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SPARK_ACTION_OPTION } from '@spark-outpost/contracts';
import { listSetupDrafts } from '../src/persistence/setup-drafts.ts';
import { createTestApp, localClient } from './app-support.ts';
import {
  answerCard,
  confirmCard,
  recordedHooks,
  startSparkTools,
  type RecordedHooks,
  type SparkToolsHarness,
} from './spark-mcp-support.ts';
import { createTestDb, startChat, type TestDb } from './support.ts';

let t: TestDb;
let recorded: RecordedHooks;
let tools: SparkToolsHarness;
let conversationId: string;

beforeEach(async () => {
  t = await createTestDb();
  const chat = await startChat(t, 'Connect our Atlassian site acme.atlassian.net');
  conversationId = chat.conversationId;
  recorded = recordedHooks();
  tools = await startSparkTools(t, {
    conversationId,
    runId: chat.runId,
    actions: recorded.hooks,
  });
});

afterEach(async () => {
  recorded.stop();
  await tools.close();
  await t.cleanup();
});

const atlassian = {
  target: 'atlassian',
  fields: { siteUrl: 'acme.atlassian.net', email: 'me@acme.test' },
};

describe('an agent preparing a connection', { timeout: 60_000 }, () => {
  it('saves the non-secret fields for the form only after the user confirms', async () => {
    await tools.call('spark_prepare_setup', atlassian);
    expect(await listSetupDrafts(t.db, t.workspaceId)).toEqual([]);
    const card = await confirmCard(t);
    expect(card.payload.sparkAction).toMatchObject({
      action: 'prepare_setup',
      target: 'atlassian',
      name: 'Atlassian',
      fields: atlassian.fields,
    });
    expect(card.payload.sparkResult).toMatchObject({ state: 'done' });
    expect(await listSetupDrafts(t.db, t.workspaceId)).toMatchObject([
      { target: 'atlassian', fields: atlassian.fields, conversationId },
    ]);
  });

  it('saves nothing when the user declines', async () => {
    await tools.call('spark_prepare_setup', atlassian);
    await answerCard(t, SPARK_ACTION_OPTION.decline);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(await listSetupDrafts(t.db, t.workspaceId)).toEqual([]);
  });

  it('refuses a secret before any card is shown', async () => {
    const refused = await tools.call('spark_prepare_setup', {
      target: 'atlassian',
      fields: { ...atlassian.fields, apiToken: 'abc' },
    });
    expect(refused.isError).toBe(true);
    const cards = await t.db.query('SELECT 1 FROM approvals');
    expect(cards.rowCount).toBe(0);
  });

  it('lets the form read a prepared setup and clear it once used', async () => {
    await tools.call('spark_prepare_setup', atlassian);
    await confirmCard(t);
    const api = localClient(createTestApp(t));
    const listed = await api.get('/api/setup-drafts');
    expect(listed.body.drafts).toMatchObject([{ target: 'atlassian', fields: atlassian.fields }]);
    const cleared = await api.send('delete', '/api/setup-drafts/atlassian');
    expect(cleared.body.drafts).toEqual([]);
  });
});
