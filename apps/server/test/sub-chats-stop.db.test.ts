import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { STOP_ONLY_OWN_SUB_CHATS } from '../src/spark-mcp/tools/stop-sub-chat.ts';
import { deliverAsk } from '../src/sub-chats/delivery.ts';
import { fakeTarget, messageAsk, turnsOf } from './chat-ask-fixtures.ts';
import {
  confirmCard,
  pendingCard,
  recordedHooks,
  startSparkTools,
  type RecordedHooks,
  type SparkToolsHarness,
} from './spark-mcp-support.ts';
import { addSubChat, emptyChat, turnIn } from './sub-chat-fixtures.ts';
import { parentChat, projectAt, userTurn, type ParentChat } from './sub-chat-plan-fixtures.ts';
import { connectCliProvider, createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let scratch: string;
let recorded: RecordedHooks;
let tools: SparkToolsHarness | null = null;
let parent: ParentChat;
let piece: string;

beforeEach(async () => {
  t = await createTestDb();
  recorded = recordedHooks();
  await connectCliProvider(t, 'claude');
  scratch = await realpath(await mkdtemp(join(tmpdir(), 'spark-sub-chat-stop-')));
  parent = await parentChat(t, await projectAt(t, scratch, 'shop'));
  piece = await addSubChat(t, parent.id, 'Orders API');
});

afterEach(async () => {
  recorded.stop();
  await tools?.close();
  tools = null;
  await t.cleanup();
  await rm(scratch, { recursive: true, force: true });
});

async function stopFrom(runId: string, chat: string) {
  tools = await startSparkTools(t, { conversationId: parent.id, runId, actions: recorded.hooks });
  return tools.call('spark_stop_chat', { chat });
}

async function cancelRequested(runId: string): Promise<boolean> {
  const { rows } = await t.db.query<{ asked: boolean }>(
    'SELECT cancel_requested_at IS NOT NULL AS asked FROM runs WHERE id = $1',
    [runId],
  );
  return rows[0]?.asked === true;
}

async function stopAudit(runId: string): Promise<string> {
  const { rows } = await t.db.query<{ payload: unknown }>(
    `SELECT payload FROM run_protocol_log WHERE run_id = $1 AND method = 'spark/sub_chat'`,
    [runId],
  );
  return JSON.stringify(rows.map((row) => row.payload));
}

describe('spark_stop_chat from a parent chat', () => {
  it('stops its own sub-chat’s running turn at once in Auto, and audits who stopped it', async () => {
    const running = await turnIn(t, piece, 'running');
    const runId = await userTurn(t, parent.id, 'Carry on.', 'auto');

    const stopped = (await stopFrom(runId, piece)).json<{ outcome: string; message: string }>();

    expect(stopped).toMatchObject({ outcome: 'done', message: 'Stopped “Orders API”.' });
    expect(await cancelRequested(running)).toBe(true);
    const audit = await stopAudit(running);
    expect(audit).toContain('"event":"turn_stopped"');
    expect(audit).toContain('"title":"Orders API"');
    expect(audit).toContain('"title":"Checkout rework"');
    expect(JSON.stringify(recorded.audited)).toContain('spark/stop_sub_chat');
  });

  it('asks on a card in a mode that asks, and stops when the user confirms', async () => {
    const running = await turnIn(t, piece, 'running');
    const runId = await userTurn(t, parent.id, 'Carry on.', 'default');

    const asked = (await stopFrom(runId, piece)).json<{ outcome: string }>();

    expect(asked.outcome).toBe('waiting_for_user');
    expect((await pendingCard(t)).title).toBe('Stop “Orders API”?');
    expect(await cancelRequested(running)).toBe(false);
    await confirmCard(t);
    expect(await cancelRequested(running)).toBe(true);
  });

  it('stops nothing in a chat that is not its own sub-chat', async () => {
    const other = await emptyChat(t, 'Billing export');
    const otherRun = await turnIn(t, other, 'running');
    const elsewhere = await parentChat(t, { id: parent.projectId, root: parent.root });
    const theirs = await addSubChat(t, elsewhere.id, 'Their piece');
    const theirRun = await turnIn(t, theirs, 'running');
    const runId = await userTurn(t, parent.id, 'Stop Billing export.', 'bypassPermissions');

    const refused = await stopFrom(runId, other);
    expect(refused.isError).toBe(true);
    expect(refused.text).toBe(STOP_ONLY_OWN_SUB_CHATS);
    expect((await tools!.call('spark_stop_chat', { chat: theirs })).text).toBe(
      STOP_ONLY_OWN_SUB_CHATS,
    );
    expect(await cancelRequested(otherRun)).toBe(false);
    expect(await cancelRequested(theirRun)).toBe(false);
  });

  it('says so when nothing is running in the sub-chat', async () => {
    const runId = await userTurn(t, parent.id, 'Carry on.', 'auto');

    const stopped = (await stopFrom(runId, piece)).json<{ message: string }>();

    expect(stopped.message).toBe('Nothing was running in “Orders API”.');
  });

  it('follows the mode in a turn a sub-chat’s reply started', async () => {
    const running = await turnIn(t, piece, 'running');
    const id = await messageAsk(t, { id: piece, title: 'Orders API' }, parent.id, 'Stuck.');
    await t.db.query(`UPDATE chat_asks SET kind = 'reply' WHERE id = $1`, [id]);
    await deliverAsk(t.db, id, fakeTarget);
    const runId = (await turnsOf(t, parent.id)).at(-1)!.id;
    await t.db.query(`UPDATE runs SET provider = 'claude', used_mode = 'auto' WHERE id = $1`, [
      runId,
    ]);

    const stopped = (await stopFrom(runId, piece)).json<{ outcome: string }>();

    expect(stopped.outcome).toBe('done');
    expect(await cancelRequested(running)).toBe(true);
  });
});
