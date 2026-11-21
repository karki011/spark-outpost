import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addToQueue } from '../src/persistence/chat-queue.ts';
import { deleteConversation, updateConversation } from '../src/persistence/conversation-actions.ts';
import { setSparkPaused } from '../src/persistence/spark-pause.ts';
import { subChatRows } from '../src/persistence/sub-chats.ts';
import { deliveryPass } from '../src/sub-chats/delivery.ts';
import { askNow, fakeTarget, finishTurn, turnsOf } from './chat-ask-fixtures.ts';
import {
  PARENT_TITLE,
  parentChat,
  projectAt,
  startedPlan,
  subChatsOf,
  THREE_PIECES,
  type ParentChat,
  type SubChatRecord,
} from './sub-chat-plan-fixtures.ts';
import { turnIn } from './sub-chat-fixtures.ts';
import { endTask, startTask, taskOf } from './sub-chat-report-fixtures.ts';
import { connectCliProvider, createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let scratch: string;
let parent: ParentChat;
let api: SubChatRecord;
let page: SubChatRecord;
let docs: SubChatRecord;

beforeEach(async () => {
  t = await createTestDb();
  await connectCliProvider(t, 'claude');
  scratch = await realpath(await mkdtemp(join(tmpdir(), 'spark-sub-chat-release-')));
  parent = await parentChat(t, await projectAt(t, scratch, 'shop'));
  [api, page, docs] = (await startedPlan(t, parent, THREE_PIECES)) as [
    SubChatRecord,
    SubChatRecord,
    SubChatRecord,
  ];
});

afterEach(async () => {
  await t.cleanup();
  await rm(scratch, { recursive: true, force: true });
});

const pass = () => deliveryPass(t.db, fakeTarget);

async function started(): Promise<string[]> {
  const pieces = await subChatsOf(t, parent.id);
  return pieces.filter((piece) => piece.started_at !== null).map((piece) => piece.title);
}

async function why(title: string): Promise<string | null> {
  const rows = await subChatRows(t.db, parent.id);
  return rows.find((row) => row.title === title)?.why ?? null;
}

describe('releasing Held sub-chats', () => {
  it('starts each one when everything it waits for has reported', async () => {
    expect(await started()).toEqual(['Orders API']);
    expect(await why('Orders page')).toBe('Waits for “Orders API”.');

    await endTask(t, await taskOf(t, api.conversation_id));
    await pass();

    expect(await started()).toEqual(['Orders API', 'Orders page']);
    const task = await taskOf(t, page.conversation_id);
    expect(await askNow(t, task.askId)).toMatchObject({
      kind: 'task',
      from: { id: parent.id, title: PARENT_TITLE },
      body: 'Build the orders page.',
      state: 'waiting',
    });
    expect(await turnsOf(t, page.conversation_id)).toHaveLength(1);
    expect(await why('Docs')).toBe('Waits for “Orders page”.');

    await endTask(t, task);
    await pass();

    expect(await started()).toEqual(['Orders API', 'Orders page', 'Docs']);
    expect(await turnsOf(t, docs.conversation_id)).toHaveLength(1);
  });

  it('keeps one Held while the sub-chat it waits for works on a later message', async () => {
    await endTask(t, await taskOf(t, api.conversation_id));
    const followUp = await turnIn(t, api.conversation_id, 'running');

    await pass();
    await pass();

    expect(await started()).toEqual(['Orders API']);
    expect(await why('Orders page')).toBe('Waits for “Orders API”.');

    await finishTurn(t, followUp, 'succeeded', 'Tidied.');
    await pass();

    expect(await started()).toEqual(['Orders API', 'Orders page']);
  });

  it('stops waiting on a message that stays queued once the later turn failed', async () => {
    await endTask(t, await taskOf(t, api.conversation_id));
    const followUp = await turnIn(t, api.conversation_id, 'running');
    await addToQueue(t.db, api.conversation_id, { id: randomUUID(), content: 'And the docs.' });
    await pass();
    expect(await why('Orders page')).toBe('Waits for “Orders API”.');

    await finishTurn(t, followUp, 'failed');
    await pass();

    expect(await started()).toEqual(['Orders API']);
    expect(await why('Orders page')).toBe(
      'Held: “Orders API” did not finish. Start anyway starts it.',
    );
  });

  it('starts nothing twice however many passes run', async () => {
    await endTask(t, await taskOf(t, api.conversation_id));

    await Promise.all([pass(), pass()]);
    await pass();

    expect(await turnsOf(t, page.conversation_id)).toHaveLength(1);
    const { rows } = await t.db.query(
      `SELECT 1 FROM chat_asks WHERE kind = 'task' AND to_conversation_id = $1`,
      [page.conversation_id],
    );
    expect(rows).toHaveLength(1);
  });

  it('finishes a release that stopped after the task was written and before it was delivered', async () => {
    await endTask(t, await taskOf(t, api.conversation_id));
    await deliveryPass(t.db, async () => {
      throw new Error('The provider lookup is down.');
    });
    const [released] = (await subChatsOf(t, parent.id)).filter(
      (piece) => piece.conversation_id === page.conversation_id,
    );
    expect(released?.task_ask_id).not.toBeNull();
    await t.db.query('DELETE FROM chat_queue WHERE id = $1', [released!.task_ask_id]);
    expect(await turnsOf(t, page.conversation_id)).toEqual([]);

    await pass();
    await pass();

    const turns = await turnsOf(t, page.conversation_id);
    expect(turns.map((turn) => turn.user_message_id)).toEqual([released!.task_ask_id]);
  });

  it.each(['failed', 'cancelled'] as const)(
    'keeps one Held, and says why, behind a sub-chat whose task turn %s',
    async (status) => {
      await endTask(t, await taskOf(t, api.conversation_id), status, '');

      await pass();
      await pass();

      expect(await started()).toEqual(['Orders API']);
      expect(await why('Orders page')).toBe(
        'Held: “Orders API” did not finish. Start anyway starts it.',
      );
      expect(await why('Docs')).toBe(
        'Held: “Orders API” did not finish and “Orders page” cannot start by itself. Start anyway starts it.',
      );
      expect(await turnsOf(t, page.conversation_id)).toEqual([]);
    },
  );

  it('starts the rest by itself after Start anyway and its report', async () => {
    await endTask(t, await taskOf(t, api.conversation_id), 'failed', '');
    await pass();

    const task = await startTask(t, page.conversation_id);
    await endTask(t, task);
    await pass();

    expect(await started()).toEqual(['Orders API', 'Orders page']);
    expect(await why('Docs')).toBe('Held: “Orders API” did not finish. Start anyway starts it.');
  });

  it('holds while Spark is paused and starts when it resumes', async () => {
    await setSparkPaused(t.db, t.workspaceId, true);
    await endTask(t, await taskOf(t, api.conversation_id));

    await pass();
    expect(await started()).toEqual(['Orders API']);

    await setSparkPaused(t.db, t.workspaceId, false);
    await pass();
    expect(await started()).toEqual(['Orders API', 'Orders page']);
  });

  it('does not wait forever on a sub-chat that was deleted', async () => {
    await deleteConversation(t.db, t.workspaceId, api.conversation_id);

    await pass();

    expect(await started()).toEqual(['Orders page']);
  });

  it('does not wait forever on a sub-chat that was archived', async () => {
    await endTask(t, await taskOf(t, api.conversation_id), 'failed', '');
    await pass();
    expect(await started()).toEqual(['Orders API']);

    await updateConversation(t.db, t.workspaceId, api.conversation_id, { archived: true });
    await pass();

    expect(await started()).toEqual(['Orders API', 'Orders page']);
  });
});
