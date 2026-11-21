import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sendUserMessage } from '../src/persistence/conversations.ts';
import { chatMessagesNeed } from '../src/sub-chats/availability.ts';
import { SEND_REFUSALS } from '../src/sub-chats/asks.ts';
import { deliverAsk } from '../src/sub-chats/deliver-ask.ts';
import { askNow, fakeTarget, messageAsk, turnsOf } from './chat-ask-fixtures.ts';
import {
  confirmCard,
  pendingCard,
  recordedHooks,
  startSparkTools,
  type RecordedHooks,
  type SparkToolsHarness,
} from './spark-mcp-support.ts';
import { addSubChat, emptyChat } from './sub-chat-fixtures.ts';
import { connectCliProvider, createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let recorded: RecordedHooks;
let tools: SparkToolsHarness | null = null;
let own: string;
let other: string;

beforeEach(async () => {
  t = await createTestDb();
  recorded = recordedHooks();
  await connectCliProvider(t, 'claude');
  own = await emptyChat(t, 'Orders API');
  other = await emptyChat(t, 'Billing export');
});

afterEach(async () => {
  recorded.stop();
  await tools?.close();
  tools = null;
  await t.cleanup();
});

async function turn(conversationId: string, content: string, mode: string): Promise<string> {
  const sent = await sendUserMessage(
    t.db,
    conversationId,
    { id: randomUUID(), content, source: 'ui' },
    { provider: 'fake' },
  );
  await t.db.query('DELETE FROM jobs WHERE run_id = $1', [sent.run.id]);
  await t.db.query(
    `UPDATE runs SET provider = 'claude', used_mode = $2, status = 'running' WHERE id = $1`,
    [sent.run.id, mode],
  );
  return sent.run.id;
}

async function toolsFor(conversationId: string, runId: string): Promise<SparkToolsHarness> {
  tools = await startSparkTools(t, { conversationId, runId, actions: recorded.hooks });
  return tools;
}

interface Sent {
  outcome: string;
  askId?: string;
  delivered?: string;
  message?: string;
}

const audited = () => JSON.stringify(recorded.audited);

describe('spark_send_to_chat from a chat', () => {
  it('sends to the chat’s own sub-chat at once in Auto, and audits it without the text', async () => {
    const subChat = await addSubChat(t, own, 'Totals');
    const runId = await turn(own, 'Split the work.', 'auto');
    const harness = await toolsFor(own, runId);

    const sent = (
      await harness.call('spark_send_to_chat', {
        chat: subChat,
        message: 'Use total_cents, not total.',
        reply: true,
      })
    ).json<Sent>();

    expect(sent).toMatchObject({ outcome: 'done', delivered: 'started' });
    expect(sent.message).toContain('Asked “Totals”.');
    expect(sent.message).toContain('Do not wait for it or poll');
    expect(await askNow(t, sent.askId!)).toMatchObject({
      kind: 'message',
      from: { id: own, title: 'Orders API' },
      fromRunId: runId,
      to: { id: subChat, title: 'Totals' },
      state: 'waiting',
      deliveredAs: 'turn',
    });
    expect((await turnsOf(t, subChat))[0]?.source).toBe('chat');
    expect(audited()).toContain('spark/send_to_chat');
    expect(audited()).toContain('"allowedBy":"mode"');
    expect(audited()).toContain('"title":"Totals"');
    expect(audited()).not.toContain('total_cents');
  });

  it('shows a card for a sub-chat in a mode that asks, and sends when the user confirms', async () => {
    const subChat = await addSubChat(t, own, 'Totals');
    const runId = await turn(own, 'Split the work.', 'default');
    const harness = await toolsFor(own, runId);

    const asked = (
      await harness.call('spark_send_to_chat', { chat: subChat, message: 'Use total_cents.' })
    ).json<Sent>();
    expect(asked.outcome).toBe('waiting_for_user');
    const card = await pendingCard(t);
    expect(card.title).toBe('Send this to “Totals”?');
    expect(await turnsOf(t, subChat)).toEqual([]);

    const done = await confirmCard(t);

    expect(done.payload.sparkResult?.message).toContain('Sent to “Totals”.');
    expect((await turnsOf(t, subChat))[0]?.source).toBe('chat');
  });

  it('asks on a card for any other chat in every mode when the user did not ask for it', async () => {
    const runId = await turn(own, 'Fix the totals.', 'bypassPermissions');
    const harness = await toolsFor(own, runId);

    const asked = (
      await harness.call('spark_send_to_chat', { chat: other, message: 'Rebase on main.' })
    ).json<Sent>();

    expect(asked.outcome).toBe('waiting_for_user');
    expect(audited()).toContain('"allowedBy":"card"');
    expect(await turnsOf(t, other)).toEqual([]);
  });

  it('sends to another chat when the user’s own message asked for it by name', async () => {
    const runId = await turn(own, 'Tell Billing export to rebase on main.', 'default');
    const harness = await toolsFor(own, runId);

    const sent = (
      await harness.call('spark_send_to_chat', { chat: other, message: 'Rebase on main.' })
    ).json<Sent>();

    expect(sent).toMatchObject({ outcome: 'done', delivered: 'started' });
    expect(audited()).toContain('"allowedBy":"your message asked"');
    const { rows } = await t.db.query<{ decided_by: string; asked: boolean | null }>(
      `SELECT decided_by, (payload->>'sparkAskedFor')::boolean AS asked FROM approvals
       WHERE run_id = $1`,
      [runId],
    );
    expect(rows).toEqual([{ decided_by: 'level', asked: true }]);
  });

  it('sends when the message names a chat titled after a file and waits for its reply', async () => {
    const notes = await emptyChat(t, 'Create notes.txt containing hello');
    const runId = await turn(
      own,
      'Ask the chat "Create notes.txt containing hello" what file it changed, and wait for its reply.',
      'default',
    );
    const harness = await toolsFor(own, runId);

    const sent = (
      await harness.call('spark_send_to_chat', { chat: notes, message: 'Which file?', reply: true })
    ).json<Sent>();

    expect(sent).toMatchObject({ outcome: 'done', delivered: 'started' });
  });

  it('asks on a card when the message names a longer chat title that holds this one', async () => {
    const longer = await emptyChat(t, 'Billing export v2');
    const runId = await turn(own, 'Tell Billing export v2 to rebase on main.', 'default');
    const harness = await toolsFor(own, runId);

    const toShorter = (
      await harness.call('spark_send_to_chat', { chat: other, message: 'Rebase on main.' })
    ).json<Sent>();
    expect(toShorter.outcome).toBe('waiting_for_user');
    expect(await turnsOf(t, other)).toEqual([]);
    expect(await turnsOf(t, longer)).toEqual([]);
  });

  it('does not mark a send the mode allowed as asked for', async () => {
    const subChat = await addSubChat(t, own, 'Totals');
    const runId = await turn(own, 'Split the work.', 'auto');
    const harness = await toolsFor(own, runId);

    await harness.call('spark_send_to_chat', { chat: subChat, message: 'Use total_cents.' });

    const { rows } = await t.db.query<{ asked: string | null }>(
      `SELECT payload->>'sparkAskedFor' AS asked FROM approvals WHERE run_id = $1`,
      [runId],
    );
    expect(rows).toEqual([{ asked: null }]);
  });

  it('refuses a chain, and answers the asking chat with replyTo without a card', async () => {
    const third = await emptyChat(t, 'Search index');
    const from = { id: other, title: 'Billing export' };
    const askId = await messageAsk(t, from, own, 'Which column do you read?', true);
    await deliverAsk(t.db, askId, fakeTarget);
    const runId = (await turnsOf(t, own))[0]!.id;
    await t.db.query(`UPDATE runs SET provider = 'claude', used_mode = 'default' WHERE id = $1`, [
      runId,
    ]);
    const harness = await toolsFor(own, runId);

    const chained = await harness.call('spark_send_to_chat', {
      chat: third,
      message: 'Billing export wants the column name.',
    });
    expect(chained.isError).toBe(true);
    expect(chained.text).toBe(SEND_REFUSALS.chain);
    expect(audited()).toContain('"outcome":"refused"');

    const replied = (
      await harness.call('spark_send_to_chat', { replyTo: askId, message: 'total_cents' })
    ).json<Sent>();

    expect(replied).toMatchObject({ outcome: 'done', delivered: 'started' });
    expect((await askNow(t, askId)).state).toBe('replied');
    expect((await turnsOf(t, other))[0]?.source).toBe('chat');
    expect(audited()).toContain('"how":"replyTo"');
    expect(audited()).not.toContain('total_cents');

    const again = await harness.call('spark_send_to_chat', { replyTo: askId, message: 'again' });
    expect(again.text).toBe(SEND_REFUSALS.notWaiting);
  });

  it('refuses a Terminal session, an archived chat, Ask Spark’s chat and the chat itself', async () => {
    const terminal = await emptyChat(t, 'Shell');
    await t.db.query(`UPDATE conversations SET session_type = 'terminal' WHERE id = $1`, [
      terminal,
    ]);
    const archived = await emptyChat(t, 'Old work');
    await t.db.query('UPDATE conversations SET archived_at = now() WHERE id = $1', [archived]);
    const assistant = await emptyChat(t, 'Ask Spark');
    await t.db.query(
      `INSERT INTO profiles (workspace_id, assistant_conversation_id) VALUES ($1, $2)
       ON CONFLICT (workspace_id) DO UPDATE SET assistant_conversation_id = $2`,
      [t.workspaceId, assistant],
    );
    const runId = await turn(own, 'Tell Shell, Old work and Ask Spark to stop.', 'auto');
    const harness = await toolsFor(own, runId);
    const refusal = async (chat: string) =>
      (await harness.call('spark_send_to_chat', { chat, message: 'Stop.' })).text;

    expect(await refusal(terminal)).toBe(SEND_REFUSALS.terminal);
    expect(await refusal(archived)).toBe(SEND_REFUSALS.archived);
    expect(await refusal(assistant)).toBe(SEND_REFUSALS.assistant);
    expect(await refusal(own)).toBe(SEND_REFUSALS.self);
    expect(await refusal(randomUUID())).toBe(SEND_REFUSALS.missing);
  });
});

describe('which turns may message other chats', () => {
  it('offers it to a chat’s own top-level turn only', async () => {
    const runId = await turn(own, 'Fix the totals.', 'auto');
    expect(await chatMessagesNeed(t.db, { conversationId: own, runId })).toBe(true);
    expect(await chatMessagesNeed(t.db, { conversationId: own, runId: null })).toBe(false);
    expect(await chatMessagesNeed(t.db, { conversationId: null, runId })).toBe(false);

    await t.db.query(`UPDATE runs SET source = 'voice' WHERE id = $1`, [runId]);
    expect(await chatMessagesNeed(t.db, { conversationId: own, runId })).toBe(false);
  });

  it('never offers it to a child run, a Terminal session or a hidden crew chat', async () => {
    const parentRun = await turn(own, 'Fix the totals.', 'auto');
    const childRun = await turn(own, 'Review it.', 'auto');
    await t.db.query(`UPDATE runs SET parent_run_id = $2, role = 'builder' WHERE id = $1`, [
      childRun,
      parentRun,
    ]);
    expect(await chatMessagesNeed(t.db, { conversationId: own, runId: childRun })).toBe(false);

    const terminalRun = await turn(other, 'Run it.', 'auto');
    await t.db.query(`UPDATE conversations SET session_type = 'terminal' WHERE id = $1`, [other]);
    expect(await chatMessagesNeed(t.db, { conversationId: other, runId: terminalRun })).toBe(false);

    const crew = await emptyChat(t, 'Test run');
    const crewRun = await turn(crew, 'Try it.', 'auto');
    await t.db.query(`UPDATE conversations SET kind = 'crew' WHERE id = $1`, [crew]);
    expect(await chatMessagesNeed(t.db, { conversationId: crew, runId: crewRun })).toBe(false);
  });
});
