import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { conversationRunsSchema } from '@spark-outpost/contracts';
import { getConversationRuns } from '../src/persistence/conversation-runs.ts';
import {
  createConversation,
  getConversationDetail,
  sendUserMessage,
} from '../src/persistence/conversations.ts';
import request from 'supertest';
import { createApp } from '../src/api/app.ts';
import { createTestDb, type TestDb } from './support.ts';
import { LOCAL_HEADERS, testAppOptions } from './app-support.ts';

let t: TestDb;

beforeEach(async () => {
  t = await createTestDb();
});

afterEach(async () => {
  await t.cleanup();
});

describe('the runs of a chat', () => {
  it('match the runs, usage totals and prompt cache of the chat detail', async () => {
    const conversation = await createConversation(t.db, t.workspaceId, randomUUID());
    const first = await sendUserMessage(
      t.db,
      conversation.id,
      { id: randomUUID(), content: 'One' },
      { provider: 'fake' },
    );
    await t.db.query(
      `UPDATE runs SET context_used = 700, context_size = 1000, cost_usd = 0.25,
         input_tokens = 40, output_tokens = 2, total_tokens = 42 WHERE id = $1`,
      [first.run.id],
    );
    await t.db.query(
      `INSERT INTO runs (id, conversation_id, user_message_id, provider, status, parent_run_id,
         role, cost_usd)
       SELECT $1, conversation_id, user_message_id, provider, 'succeeded', id, 'coordinator', 0.5
       FROM runs WHERE id = $2`,
      [randomUUID(), first.run.id],
    );

    const slice = conversationRunsSchema.parse(await getConversationRuns(t.db, conversation.id));
    const detail = await getConversationDetail(t.db, conversation.id);

    expect(slice.runs).toEqual(detail?.runs);
    expect(slice.runs).toHaveLength(1);
    expect(slice.runs[0]?.usage?.contextUsed).toBe(700);
    expect(slice.usageTotals.costUsd).toBe(0.75);
    expect({ ...slice.usageTotals, advisors: detail?.usageTotals.advisors }).toEqual(
      detail?.usageTotals,
    );
    expect(slice.promptCache).toEqual(detail?.promptCache);
  });

  it('are empty for a chat that does not exist', async () => {
    const slice = await getConversationRuns(t.db, randomUUID());
    expect(slice.runs).toEqual([]);
    expect(slice.usageTotals.byProvider).toEqual([]);
  });

  it('are served on their own route', async () => {
    const conversation = await createConversation(t.db, t.workspaceId, randomUUID());
    await sendUserMessage(
      t.db,
      conversation.id,
      { id: randomUUID(), content: 'One' },
      { provider: 'fake' },
    );
    const response = await request(createApp(testAppOptions(t)))
      .get(`/api/conversations/${conversation.id}/runs`)
      .set(LOCAL_HEADERS);
    expect(response.status).toBe(200);
    expect(conversationRunsSchema.parse(response.body).runs).toHaveLength(1);
  });
});

describe('the chat detail', () => {
  it('answers 304 with no body while nothing changed, and the full detail after a change', async () => {
    const conversation = await createConversation(t.db, t.workspaceId, randomUUID());
    const app = createApp(testAppOptions(t));
    const path = `/api/conversations/${conversation.id}`;
    const first = await request(app).get(path).set(LOCAL_HEADERS);
    const etag = String(first.headers.etag);
    expect(first.status).toBe(200);
    expect(etag).not.toBe('undefined');

    const unchanged = await request(app).get(path).set(LOCAL_HEADERS).set('If-None-Match', etag);
    expect(unchanged.status).toBe(304);
    expect(unchanged.text).toBe('');

    await sendUserMessage(
      t.db,
      conversation.id,
      { id: randomUUID(), content: 'One' },
      { provider: 'fake' },
    );
    const changed = await request(app).get(path).set(LOCAL_HEADERS).set('If-None-Match', etag);
    expect(changed.status).toBe(200);
    expect(changed.headers.etag).not.toBe(etag);
  });
});
