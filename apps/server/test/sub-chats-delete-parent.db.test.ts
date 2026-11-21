import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getSummary } from '../src/persistence/conversations.ts';
import { getSubChat } from '../src/persistence/sub-chats.ts';
import { deliveryPass } from '../src/sub-chats/delivery.ts';
import { createTestApp, LOCAL_HEADERS, ORIGIN } from './app-support.ts';
import { askNow, fakeTarget } from './chat-ask-fixtures.ts';
import {
  confirmCard,
  recordedHooks,
  startSparkTools,
  type RecordedHooks,
  type SparkToolsHarness,
} from './spark-mcp-support.ts';
import {
  PARENT_TITLE,
  parentChat,
  projectAt,
  subChatsOf,
  THREE_PIECES,
  userTurn,
  type ParentChat,
  type SubChatRecord,
} from './sub-chat-plan-fixtures.ts';
import { endTask, taskOf } from './sub-chat-report-fixtures.ts';
import { connectCliProvider, createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let scratch: string;
let recorded: RecordedHooks;
let tools: SparkToolsHarness | null = null;
let parent: ParentChat;

beforeEach(async () => {
  t = await createTestDb();
  recorded = recordedHooks();
  await connectCliProvider(t, 'claude');
  scratch = await realpath(await mkdtemp(join(tmpdir(), 'spark-sub-chats-delete-')));
  parent = await parentChat(t, await projectAt(t, scratch, 'shop'));
});

afterEach(async () => {
  recorded.stop();
  await tools?.close();
  tools = null;
  await t.cleanup();
  await rm(scratch, { recursive: true, force: true });
});

async function split(mode: string): Promise<SubChatRecord[]> {
  const runId = await userTurn(t, parent.id, 'Fix checkout.', mode);
  tools = await startSparkTools(t, {
    conversationId: parent.id,
    runId,
    actions: recorded.hooks,
  });
  await tools.call('spark_sub_chats', { pieces: THREE_PIECES });
  if (mode === 'default') await confirmCard(t);
  const pieces = await subChatsOf(t, parent.id);
  expect(pieces).toHaveLength(3);
  expect(pieces.every((piece) => piece.approval_id !== null)).toBe(true);
  return pieces;
}

function removeParent() {
  return request(createTestApp(t, { deleteSettleMs: 0 }))
    .delete(`/api/conversations/${parent.id}`)
    .set(LOCAL_HEADERS)
    .set('Origin', ORIGIN)
    .send({});
}

async function expectLeftBehind(pieces: readonly SubChatRecord[]): Promise<void> {
  const { rows } = await t.db.query('SELECT 1 FROM conversations WHERE id = $1', [parent.id]);
  expect(rows).toEqual([]);
  for (const piece of pieces) {
    const kept = await getSummary(t.db, piece.conversation_id);
    expect(kept?.title).toBe(piece.title);
    expect(kept?.parent).toBeUndefined();
    expect(kept?.formerParent).toEqual({ title: PARENT_TITLE });
  }
  const left = await t.db.query<{ approval_id: string | null; stacked_on: string | null }>(
    `SELECT approval_id, stacked_on FROM sub_chats WHERE conversation_id = ANY($1::uuid[])
     ORDER BY position`,
    [pieces.map((piece) => piece.conversation_id)],
  );
  expect(left.rows.map((row) => row.approval_id)).toEqual([null, null, null]);
  expect(left.rows[1]?.stacked_on).toBe(pieces[0]!.conversation_id);
}

describe('deleting a parent that started sub-chats', () => {
  it('keeps the sub-chats it started from a plan card', async () => {
    const pieces = await split('default');

    await removeParent().expect(204);

    await expectLeftBehind(pieces);
  });

  it('keeps the sub-chats it started at once in Auto', async () => {
    const pieces = await split('auto');

    await removeParent().expect(204);

    await expectLeftBehind(pieces);
  });

  it('lets a sub-chat finish its task after the parent is gone, with nobody to report to', async () => {
    const [api] = await split('auto');
    const task = await taskOf(t, api!.conversation_id);
    await removeParent().expect(204);

    await endTask(t, task);
    await deliveryPass(t.db, fakeTarget);

    expect(await askNow(t, task.askId)).toMatchObject({
      state: 'replied',
      from: { id: null, title: PARENT_TITLE },
      fromRunId: null,
    });
    expect((await getSubChat(t.db, api!.conversation_id))?.report).toMatchObject({
      reason: null,
      changed: 'GET /orders returns total_cents.',
    });
    const { rows } = await t.db.query(`SELECT 1 FROM chat_asks WHERE kind = 'report'`);
    expect(rows).toEqual([]);
  });
});
