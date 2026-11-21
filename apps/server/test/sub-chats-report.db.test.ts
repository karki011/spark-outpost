import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { waitingAsksWithEndedTurn } from '../src/persistence/chat-asks.ts';
import { deleteConversation } from '../src/persistence/conversation-actions.ts';
import { getMemberMessage } from '../src/persistence/member-messages.ts';
import {
  NO_REPLY_REASONS,
  SEND_REFUSALS,
  sendRule,
  targetChat,
  turnStart,
  waitingAskFor,
} from '../src/sub-chats/asks.ts';
import { subChatNeeds } from '../src/sub-chats/availability.ts';
import { deliverAsk } from '../src/sub-chats/deliver-ask.ts';
import { deliveryPass } from '../src/sub-chats/delivery.ts';
import { NONE_STATED, REPORT_FOOTER, TURN_REASONS } from '../src/sub-chats/report.ts';
import { sendReport } from '../src/sub-chats/reports.ts';
import { loadRunInput } from '../src/workflow/run-input.ts';
import { askNow, fakeTarget, finishTurn, messageAsk, turnsOf } from './chat-ask-fixtures.ts';
import { addPullRequest, addSubChat, emptyChat, turnIn } from './sub-chat-fixtures.ts';
import { PARENT_TITLE, parentChat, projectAt, type ParentChat } from './sub-chat-plan-fixtures.ts';
import {
  asksOf,
  endTask,
  reportedAt,
  reportOn,
  startTask,
  type StartedTask,
} from './sub-chat-report-fixtures.ts';
import { connectCliProvider, createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let scratch: string;
let parent: ParentChat;
let api: StartedTask;

beforeEach(async () => {
  t = await createTestDb();
  await connectCliProvider(t, 'claude');
  scratch = await realpath(await mkdtemp(join(tmpdir(), 'spark-sub-chat-report-')));
  parent = await parentChat(t, await projectAt(t, scratch, 'shop'));
  api = await startTask(t, await addSubChat(t, parent.id, 'Orders API'));
});

afterEach(async () => {
  await t.cleanup();
  await rm(scratch, { recursive: true, force: true });
});

const pass = () => deliveryPass(t.db, fakeTarget);

describe('a sub-chat’s report to its parent', () => {
  it('is built when the task turn ends and starts one turn in the parent', async () => {
    await addPullRequest(t, api.id, 'open', 41);
    await endTask(t, api);

    await pass();

    const report = await reportOn(t, api.id);
    expect(report).toMatchObject({
      status: 'ready_for_review',
      reason: null,
      changed: 'GET /orders returns total_cents.',
      risks: 'The old total field is gone.',
      blockers: 'None',
      committed: false,
      pushed: false,
      pullRequest: { number: 41, state: 'open', checks: 'passing' },
    });
    expect(await askNow(t, api.askId)).toMatchObject({ state: 'replied', noReplyReason: null });
    const [sent, ...more] = await asksOf(t, parent.id, 'report');
    expect(more).toEqual([]);
    expect(sent).toMatchObject({
      from: { id: api.id, title: 'Orders API' },
      replyTo: api.askId,
      state: null,
      report,
    });
    expect(sent!.body).toContain('Status: Ready for review');
    expect(sent!.body).toContain('pull request #41 (open, checks passing)');
    expect(sent!.body).toContain(REPORT_FOOTER);
    const [turn, ...others] = await turnsOf(t, parent.id);
    expect(others).toEqual([]);
    expect(turn).toMatchObject({ source: 'chat', user_message_id: sent!.id });
  });

  it('is delivered once however many passes run, and a late pass changes nothing', async () => {
    await endTask(t, api);

    await pass();
    const first = await reportedAt(t, api.id);
    await pass();
    await pass();

    expect(await asksOf(t, parent.id, 'report')).toHaveLength(1);
    expect(await turnsOf(t, parent.id)).toHaveLength(1);
    expect(await reportedAt(t, api.id)).toEqual(first);
    expect(await waitingAsksWithEndedTurn(t.db, ['task', 'message'])).toEqual([]);
  });

  it('is not the user’s message in the parent', async () => {
    await endTask(t, api);
    await pass();
    const [turn] = await turnsOf(t, parent.id);

    const input = await loadRunInput(t.db, turn!.id);

    expect(input.assistantSent).toBe(true);
    expect(input.chatAsk).toMatchObject({ kind: 'report', fromTitle: 'Orders API' });
  });

  it('is steered into a parent that is busy', async () => {
    const busy = await turnIn(t, parent.id, 'running');
    await endTask(t, api);

    await pass();

    const [sent] = await asksOf(t, parent.id, 'report');
    expect(await getMemberMessage(t.db, sent!.id)).toMatchObject({ runId: busy, urgency: 'now' });
    expect(await turnsOf(t, parent.id)).toHaveLength(1);
  });

  it('is delivered once when Spark stopped between writing it and delivering it', async () => {
    await endTask(t, api);
    const [ended] = await waitingAsksWithEndedTurn(t.db, ['task']);
    const reportId = await sendReport(t.db, ended!);
    expect(reportId).not.toBeNull();
    expect(await turnsOf(t, parent.id)).toEqual([]);

    await pass();
    await pass();

    expect(await asksOf(t, parent.id, 'report')).toHaveLength(1);
    const turns = await turnsOf(t, parent.id);
    expect(turns.map((turn) => turn.user_message_id)).toEqual([reportId]);
  });

  it('is written once when two passes see the same ended turn', async () => {
    await endTask(t, api);
    const [ended] = await waitingAsksWithEndedTurn(t.db, ['task']);

    const written = await Promise.all([sendReport(t.db, ended!), sendReport(t.db, ended!)]);

    expect(written.filter((id) => id !== null)).toHaveLength(1);
    expect(await asksOf(t, parent.id, 'report')).toHaveLength(1);
  });

  it.each([
    ['failed', 'Its turn failed: The agent crashed.'],
    ['cancelled', TURN_REASONS.stopped],
  ] as const)(
    'says so when the task turn %s, and the parent still hears',
    async (status, reason) => {
      await endTask(t, api, status, 'Changed: half of the endpoint.');
      if (status === 'failed') {
        await t.db.query(`UPDATE runs SET error = 'The agent crashed.' WHERE id = $1`, [api.runId]);
      }

      await pass();

      expect(await reportOn(t, api.id)).toMatchObject({
        status: 'needs_you',
        reason,
        changed: 'half of the endpoint.',
        risks: NONE_STATED,
      });
      expect(await askNow(t, api.askId)).toMatchObject({
        state: 'no_reply',
        noReplyReason: reason,
      });
      const [sent] = await asksOf(t, parent.id, 'report');
      expect(sent!.body).toContain(`Status: Needs you (${reason})`);
      expect(await turnsOf(t, parent.id)).toHaveLength(1);
      expect(await asksOf(t, parent.id, 'reply')).toEqual([]);
    },
  );

  it('waits while the task turn still runs', async () => {
    await pass();
    expect(await reportOn(t, api.id)).toBeNull();
    expect(await asksOf(t, parent.id, 'report')).toEqual([]);
  });

  it('records the report in the task turn’s audit without its text', async () => {
    await endTask(t, api);
    await pass();

    const { rows } = await t.db.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM run_protocol_log WHERE run_id = $1 AND method = 'spark/chat_ask'`,
      [api.runId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payload).toMatchObject({
      event: 'report',
      from: { id: parent.id, title: PARENT_TITLE },
      to: { id: api.id, title: 'Orders API' },
    });
    expect(JSON.stringify(rows[0]!.payload)).not.toContain('total_cents');
  });

  it('refuses replyTo on a task, which is reported when the turn ends', async () => {
    await expect(waitingAskFor(t.db, api.askId, api.id)).rejects.toThrow(SEND_REFUSALS.taskReports);
  });
});

describe('later turns in a sub-chat', () => {
  beforeEach(async () => {
    await endTask(t, api);
    await pass();
    await finishTurn(t, (await turnsOf(t, parent.id))[0]!.id, 'succeeded', 'Noted.');
  });

  it('refresh its row from a turn the user typed without starting a parent turn', async () => {
    const before = await reportedAt(t, api.id);
    const typed = await turnIn(t, api.id, 'running');
    await pass();
    expect(await reportedAt(t, api.id)).toEqual(before);

    await finishTurn(t, typed, 'succeeded', 'Changed: renamed the field.\nRisks: None');
    await pass();
    await pass();

    expect(await reportOn(t, api.id)).toMatchObject({
      changed: 'renamed the field.',
      reason: null,
    });
    expect((await reportedAt(t, api.id))!.getTime()).toBeGreaterThan(before!.getTime());
    expect(await asksOf(t, parent.id, 'report')).toHaveLength(1);
    expect(await turnsOf(t, parent.id)).toHaveLength(1);
  });

  it('report again for a later message from the parent that asked for a reply', async () => {
    const from = { id: parent.id, title: PARENT_TITLE };
    const askId = await messageAsk(t, from, api.id, 'Also add a currency field.', true);
    expect(await deliverAsk(t.db, askId, fakeTarget)).toBe('started');
    const turn = (await turnsOf(t, api.id)).at(-1)!;
    await finishTurn(t, turn.id, 'succeeded', 'Changed: added currency.');

    await pass();
    await pass();

    const reports = await asksOf(t, parent.id, 'report');
    expect(reports.map((report) => report.replyTo)).toEqual([api.askId, askId]);
    expect(reports[1]!.report?.changed).toBe('added currency.');
    expect(await askNow(t, askId)).toMatchObject({ state: 'replied' });
    expect(await asksOf(t, parent.id, 'reply')).toEqual([]);
    expect(await turnsOf(t, parent.id)).toHaveLength(2);
  });
});

describe('a turn a sub-chat’s report started in its parent', () => {
  async function reportTurn(): Promise<string> {
    await endTask(t, api);
    await pass();
    return (await turnsOf(t, parent.id))[0]!.id;
  }

  async function ruleFor(runId: string, to: string) {
    return sendRule({
      fromChatId: parent.id,
      to: await targetChat(t.db, t.workspaceId, parent.id, to),
      startedBy: await turnStart(t.db, runId),
      userAsked: true,
    });
  }

  it('may message and stop any of the parent’s own sub-chats', async () => {
    const page = await addSubChat(t, parent.id, 'Orders page');
    const runId = await reportTurn();

    expect(await turnStart(t.db, runId)).toMatchObject({ kind: 'report', fromOwnSubChat: true });
    expect(await ruleFor(runId, api.id)).toEqual({ kind: 'mode' });
    expect(await ruleFor(runId, page)).toEqual({ kind: 'mode' });
    const needs = await subChatNeeds(t.db, { conversationId: parent.id, runId });
    expect(needs.sub_chat_stop).toBe(true);
  });

  it('may not message any other chat and gets no spark_sub_chats', async () => {
    const stranger = await emptyChat(t, 'Billing export');
    const runId = await reportTurn();

    expect(await ruleFor(runId, stranger)).toEqual({
      kind: 'refuse',
      reason: SEND_REFUSALS.parentChain,
    });
    const needs = await subChatNeeds(t.db, { conversationId: parent.id, runId });
    expect(needs.sub_chats).toBe(false);
  });
});

describe('deleting a chat that an ask waits on', () => {
  it('tells the sender No reply with the reason', async () => {
    const sender = { id: await emptyChat(t, 'Billing export'), title: 'Billing export' };
    const receiver = await emptyChat(t, 'Invoices');
    await turnIn(t, receiver, 'running');
    const askId = await messageAsk(t, sender, receiver, 'Which column do you read?', true);
    await deliverAsk(t.db, askId, fakeTarget);

    await deleteConversation(t.db, t.workspaceId, receiver);
    await pass();
    await pass();

    const [notice, ...more] = await asksOf(t, sender.id, 'reply');
    expect(more).toEqual([]);
    expect(notice).toMatchObject({
      from: { id: null, title: 'Invoices' },
      body: `No reply: ${NO_REPLY_REASONS.deleted}`,
      replyTo: null,
    });
    const [turn] = await turnsOf(t, sender.id);
    expect(turn).toMatchObject({ source: 'chat', user_message_id: notice!.id });
    const input = await loadRunInput(t.db, turn!.id);
    expect(input.chatAsk).toMatchObject({ kind: 'reply', noReply: true });
  });

  it('tells a parent whose sub-chat was deleted while its task ran', async () => {
    await deleteConversation(t.db, t.workspaceId, api.id);
    await pass();

    const [notice] = await asksOf(t, parent.id, 'reply');
    expect(notice?.body).toBe(`No reply: ${NO_REPLY_REASONS.deleted}`);
    expect(await turnsOf(t, parent.id)).toHaveLength(1);
  });

  it('tells no one when the ask wanted no reply', async () => {
    const sender = { id: await emptyChat(t, 'Billing export'), title: 'Billing export' };
    const receiver = await emptyChat(t, 'Invoices');
    await messageAsk(t, sender, receiver, 'FYI: totals are in cents.', false);

    await deleteConversation(t.db, t.workspaceId, receiver);
    await pass();

    expect(await asksOf(t, sender.id, 'reply')).toEqual([]);
  });
});
