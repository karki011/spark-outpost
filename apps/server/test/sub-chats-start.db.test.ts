import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  SPARK_ACTION_OPTION,
  SUB_CHATS_STARTED_ACTIVITY,
  type StartSubChatsAction,
} from '@spark-outpost/contracts';
import { resolveChatSettings, saveCapabilities } from '../src/persistence/chat-settings.ts';
import { getConversationDetail } from '../src/persistence/conversations.ts';
import { SUB_CHAT_CANNOT_BE_PARENT } from '../src/persistence/sub-chats.ts';
import { FAKE_CODEX_MODES } from '../src/providers/fake.ts';
import { performSparkAction } from '../src/spark-mcp/actions/perform.ts';
import { NOT_FROM_ANOTHER_CHAT } from '../src/spark-mcp/tools/sub-chats-tool.ts';
import { deliverAsk } from '../src/sub-chats/deliver-ask.ts';
import { folderMissing } from '../src/sub-chats/plan.ts';
import { askNow, fakeTarget, messageAsk, turnsOf } from './chat-ask-fixtures.ts';
import {
  answerCard,
  cardResult,
  confirmCard,
  pendingCard,
  recordedHooks,
  startSparkTools,
  toolDeps,
  type RecordedHooks,
  type SparkToolsHarness,
} from './spark-mcp-support.ts';
import {
  PARENT_SETTINGS,
  PARENT_TITLE,
  parentChat,
  projectAt,
  subChatsOf,
  THREE_PIECES,
  userTurn,
  type ParentChat,
} from './sub-chat-plan-fixtures.ts';
import { emptyChat } from './sub-chat-fixtures.ts';
import { connectCliProvider, createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let scratch: string;
let recorded: RecordedHooks;
let tools: SparkToolsHarness | null = null;
let shop: { id: string; root: string };
let parent: ParentChat;

beforeEach(async () => {
  t = await createTestDb();
  recorded = recordedHooks();
  await connectCliProvider(t, 'claude');
  scratch = await realpath(await mkdtemp(join(tmpdir(), 'spark-sub-chats-')));
  shop = await projectAt(t, scratch, 'shop');
  parent = await parentChat(t, shop);
});

afterEach(async () => {
  recorded.stop();
  await tools?.close();
  tools = null;
  await t.cleanup();
  await rm(scratch, { recursive: true, force: true });
});

async function toolsFor(conversationId: string, runId: string): Promise<SparkToolsHarness> {
  tools = await startSparkTools(t, { conversationId, runId, actions: recorded.hooks });
  return tools;
}

interface Started {
  outcome: string;
  message?: string;
  next?: string;
  pieces?: { title: string; chat: string; starts: string; model: string | null }[];
  subChats?: { id: string; title: string; status: string; delivered?: string }[];
  notStarted?: { title: string; reason: string }[];
}

async function split(mode: string, pieces: unknown[] = THREE_PIECES, message = 'Fix checkout.') {
  const runId = await userTurn(t, parent.id, message, mode);
  const harness = await toolsFor(parent.id, runId);
  const called = await harness.call('spark_sub_chats', { pieces });
  return { runId, called };
}

async function activities(runId: string) {
  const { rows } = await t.db.query<{ payload: { activityType?: string; content?: unknown } }>(
    `SELECT payload FROM run_events WHERE run_id = $1 ORDER BY seq`,
    [runId],
  );
  return rows
    .filter((row) => row.payload.activityType === SUB_CHATS_STARTED_ACTIVITY)
    .map((row) => row.payload.content);
}

async function auditOf(runId: string): Promise<string> {
  const { rows } = await t.db.query<{ payload: unknown }>(
    `SELECT payload FROM run_protocol_log WHERE run_id = $1 AND method = 'spark/sub_chat'
     ORDER BY seq`,
    [runId],
  );
  return JSON.stringify(rows.map((row) => row.payload));
}

describe('spark_sub_chats in a mode that acts', () => {
  it('starts the pieces at once, holding the stacked one and the one that waits', async () => {
    const { runId, called } = await split('auto');
    const started = called.json<Started>();

    expect(started.outcome).toBe('done');
    expect(started.message).toContain('Started 3 sub-chats: Orders API, Orders page, Docs.');
    expect(started.message).toContain('Held until what they wait for has reported');
    expect(started.next).toContain('Do not poll or wait');
    expect(started.subChats?.map(({ title, status }) => [title, status])).toEqual([
      ['Orders API', 'working'],
      ['Orders page', 'held'],
      ['Docs', 'held'],
    ]);
    expect(started.pieces?.map((piece) => piece.starts)).toEqual([
      'New branch',
      'Stacked on 1',
      'Starts after 1, 2',
    ]);

    const [api, page, docs] = await subChatsOf(t, parent.id);
    expect([api?.position, page?.position, docs?.position]).toEqual([0, 1, 2]);
    expect(api).toMatchObject({ title: 'Orders API', stacked_on: null, starts_after: [] });
    expect(api?.started_at).not.toBeNull();
    expect(page).toMatchObject({ stacked_on: api!.conversation_id, started_at: null });
    expect(page?.task_ask_id).toBeNull();
    expect(docs).toMatchObject({
      stacked_on: null,
      starts_after: [api!.conversation_id, page!.conversation_id],
      started_at: null,
    });
    expect(api?.approval_id).not.toBeNull();

    const task = await askNow(t, api!.task_ask_id!);
    expect(task).toMatchObject({
      kind: 'task',
      from: { id: parent.id, title: PARENT_TITLE },
      fromRunId: runId,
      state: 'waiting',
      deliveredAs: 'turn',
      body: 'Add the orders endpoint with total_cents.',
    });
    expect((await turnsOf(t, api!.conversation_id))[0]).toMatchObject({ source: 'chat' });
    expect(await turnsOf(t, page!.conversation_id)).toEqual([]);
    const detail = await getConversationDetail(t.db, api!.conversation_id);
    expect(detail?.conversation).toMatchObject({
      title: 'Orders API',
      titleSource: 'user',
      projectIds: [shop.id],
      parent: { id: parent.id, title: PARENT_TITLE },
    });
    expect(detail?.runs[0]?.fromChat).toBe(PARENT_TITLE);
  });

  it('copies the parent’s agent, model, effort, mode and autonomy, and records them', async () => {
    await split('auto');

    for (const piece of await subChatsOf(t, parent.id)) {
      expect(await resolveChatSettings(t.db, piece.conversation_id)).toMatchObject(PARENT_SETTINGS);
      expect(piece.started_with).toEqual(PARENT_SETTINGS);
    }
  });

  it('shows one started line on the parent’s turn and audits each start without the task', async () => {
    const { runId } = await split('auto');

    const [api, page, docs] = await subChatsOf(t, parent.id);
    expect(await activities(runId)).toEqual([
      {
        subChats: [
          { id: api!.conversation_id, title: 'Orders API', held: false },
          { id: page!.conversation_id, title: 'Orders page', held: true },
          { id: docs!.conversation_id, title: 'Docs', held: true },
        ],
        notStarted: [],
      },
    ]);
    const audit = await auditOf(runId);
    expect(audit).toContain('"event":"sub_chat_started"');
    expect(audit).toContain('"allowedBy":"ran at once (mode)"');
    expect(audit).toContain('"title":"Orders page"');
    expect(audit).toContain('"effort":"high"');
    expect(audit).not.toContain('total_cents');
    expect(JSON.stringify(recorded.audited)).not.toContain('total_cents');
  });

  it('adds pieces on a second call, after the ones already there', async () => {
    await split('auto', [{ title: 'Orders API', task: 'Add the endpoint.' }]);
    await tools?.close();
    const { called } = await split('auto', [{ title: 'Search', task: 'Add search.' }]);

    expect(called.json<Started>().message).toContain('Started 1 sub-chat: Search.');
    expect((await subChatsOf(t, parent.id)).map((piece) => [piece.title, piece.position])).toEqual([
      ['Orders API', 0],
      ['Search', 1],
    ]);
    await tools?.close();
    const again = await split('auto', [{ title: 'search', task: 'Add search again.' }]);
    expect(again.called.text).toContain('already has a sub-chat called “search”');
  });
});

describe('spark_sub_chats in a mode that asks first', () => {
  it('shows one plan card and creates nothing until the user starts it', async () => {
    const { called } = await split('default');

    expect(called.json<Started>().outcome).toBe('waiting_for_user');
    const card = await pendingCard(t);
    expect(card.title).toBe('Start 3 sub-chats?');
    expect(card.options.map((option) => option.name)).toEqual(['Start', 'Discard']);
    const action = card.payload.sparkAction as StartSubChatsAction;
    expect(action.pieces.map((piece) => piece.sameAsParent)).toEqual([true, true, true]);
    expect(await subChatsOf(t, parent.id)).toEqual([]);

    const done = await confirmCard(t);

    expect(done.payload.sparkResult?.message).toContain('Started 3 sub-chats');
    const pieces = await subChatsOf(t, parent.id);
    expect(pieces.map((piece) => piece.conversation_id)).toEqual(
      action.pieces.map((piece) => piece.conversationId),
    );
    expect(pieces.every((piece) => piece.approval_id === card.id)).toBe(true);
    expect(await auditOf(card.runId)).toContain('"allowedBy":"approved on a card"');
  });

  it('starts at once in Accept edits when the user’s message asked to split', async () => {
    const { called } = await split(
      'acceptEdits',
      [{ title: 'Orders API', task: 'Add the endpoint.' }],
      'Split this into sub-chats.',
    );

    expect(called.json<Started>().outcome).toBe('done');
  });

  it('creates nothing when the user discards the card', async () => {
    await split('default');

    const card = await answerCard(t, SPARK_ACTION_OPTION.decline);

    expect((await cardResult(t, card.id)).status).toBe('denied');
    expect(await subChatsOf(t, parent.id)).toEqual([]);
  });

  it('applies the model and effort the user chose on the card, and nothing else', async () => {
    await split('default');
    const card = await pendingCard(t);
    const action = card.payload.sparkAction as StartSubChatsAction;
    const page = action.pieces[1]!.conversationId;

    await confirmCard(t, {
      edits: { subChats: [{ id: page, model: 'sonnet', effort: 'low' }] },
    });

    const pieces = await subChatsOf(t, parent.id);
    expect(pieces[1]?.started_with).toEqual({ ...PARENT_SETTINGS, model: 'sonnet', effort: 'low' });
    expect(pieces[0]?.started_with).toEqual(PARENT_SETTINGS);
    expect(pieces.map((piece) => piece.title)).toEqual(['Orders API', 'Orders page', 'Docs']);
  });

  it('starts the other pieces when one piece’s folder is gone by the time the user confirms', async () => {
    const site = await projectAt(t, scratch, 'site');
    const { called } = await split('default', [
      { title: 'Orders API', task: 'Add the endpoint.' },
      { title: 'Site', task: 'Update the site.', project: 'site' },
      { title: 'Site docs', task: 'Document it.', project: 'site', stackedOn: 'Site' },
      { title: 'Notes', task: 'Write notes.', startsAfter: ['Site'] },
    ]);
    expect(called.json<Started>().outcome).toBe('waiting_for_user');
    await rm(site.root, { recursive: true, force: true });

    const done = await confirmCard(t);

    const message = done.payload.sparkResult?.message ?? '';
    expect(message).toContain('Started 2 sub-chats: Orders API, Notes.');
    expect(message).toContain(`“Site”: ${folderMissing('site')}`);
    expect(message).toContain(`“Site docs”: ${folderMissing('site')}`);
    const pieces = await subChatsOf(t, parent.id);
    expect(pieces.map((piece) => piece.title)).toEqual(['Orders API', 'Notes']);
    expect(pieces[1]).toMatchObject({ starts_after: [] });
    expect(pieces[1]?.started_at).not.toBeNull();
    const { rows } = await t.db.query(
      `SELECT 1 FROM conversations WHERE title IN ('Site', 'Site docs')`,
    );
    expect(rows).toEqual([]);
    expect(await activities(done.runId)).toEqual([
      expect.objectContaining({
        notStarted: [
          { title: 'Site', reason: folderMissing('site') },
          { title: 'Site docs', reason: folderMissing('site') },
        ],
      }),
    ]);
  });

  it('does not start a piece stacked on one that did not start', async () => {
    await saveCapabilities(t.db, t.workspaceId, {
      provider: 'claude',
      models: [
        { id: 'opus', label: 'Opus', description: null },
        { id: 'sonnet', label: 'Sonnet', description: null },
      ],
      efforts: [],
      defaultModel: 'opus',
    });
    await split('default');
    const action = (await pendingCard(t)).payload.sparkAction as StartSubChatsAction;

    const done = await confirmCard(t, {
      edits: { subChats: [{ id: action.pieces[0]!.conversationId, model: 'haiku' }] },
    });

    const message = done.payload.sparkResult?.message ?? '';
    expect(message).toContain('Started 1 sub-chat: Docs.');
    expect(message).toContain('“Orders API”: Claude has no model called haiku.');
    expect(message).toContain('“Orders page”: It is stacked on “Orders API”, which did not start.');
    const [docs] = await subChatsOf(t, parent.id);
    expect(docs).toMatchObject({ title: 'Docs', starts_after: [] });
    expect(docs?.started_at).not.toBeNull();
  });

  it('starts nothing twice when the same approved plan is performed again', async () => {
    await split('default');
    const card = await confirmCard(t);
    const action = card.payload.sparkAction as StartSubChatsAction;
    const context = {
      deps: toolDeps(t),
      scope: { workspaceId: t.workspaceId, conversationId: parent.id, runId: card.runId },
    };

    const again = await performSparkAction(context, action, 'user', card.id);

    expect(again.message).toContain('They were already started.');
    expect(await subChatsOf(t, parent.id)).toHaveLength(3);
    const { rows } = await t.db.query(`SELECT 1 FROM chat_asks WHERE kind = 'task'`);
    expect(rows).toHaveLength(1);
    expect(await activities(card.runId)).toHaveLength(1);
  });
});

describe('who a sub-chat’s settings and mode come from', () => {
  it('gives a piece on another agent a mode capped to the parent’s', async () => {
    await connectCliProvider(t, 'codex');
    await saveCapabilities(t.db, t.workspaceId, {
      provider: 'codex',
      models: [],
      efforts: [],
      defaultModel: null,
      modes: FAKE_CODEX_MODES,
      defaultMode: 'agent',
    });
    const asking = await parentChat(t, shop, 'default');
    const runId = await userTurn(t, asking.id, 'Split this into sub-chats.', 'acceptEdits');
    const harness = await toolsFor(asking.id, runId);

    const refused = await harness.call('spark_sub_chats', {
      pieces: [{ title: 'Web', task: 'Build it.', agent: 'codex', mode: 'Full access' }],
    });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain('“Web” cannot be proposed in a mode that asks less often');

    const started = await harness.call('spark_sub_chats', {
      pieces: [{ title: 'Web', task: 'Build it.', agent: 'codex' }],
    });

    expect(started.json<Started>().outcome).toBe('done');
    const [web] = await subChatsOf(t, asking.id);
    expect(web?.started_with).toMatchObject({
      provider: 'codex',
      model: null,
      agentMode: 'ask-every-action',
      level: 'hands-off',
    });
  });

  it('refuses the tool in a sub-chat and in a turn another chat’s message started', async () => {
    await split('auto', [{ title: 'Orders API', task: 'Add the endpoint.' }]);
    await tools?.close();
    const [api] = await subChatsOf(t, parent.id);
    const subRun = (await turnsOf(t, api!.conversation_id))[0]!.id;
    const nested = await (
      await toolsFor(api!.conversation_id, subRun)
    ).call('spark_sub_chats', { pieces: [{ title: 'Deeper', task: 'Go deeper.' }] });
    expect(nested.text).toBe(SUB_CHAT_CANNOT_BE_PARENT);
    await tools?.close();

    const other = await parentChat(t, shop);
    const from = { id: await emptyChat(t, 'Billing export'), title: 'Billing export' };
    const askId = await messageAsk(t, from, other.id, 'Split your work in two.');
    await deliverAsk(t.db, askId, fakeTarget);
    const asked = (await turnsOf(t, other.id))[0]!.id;
    await t.db.query(`UPDATE runs SET provider = 'claude', used_mode = 'auto' WHERE id = $1`, [
      asked,
    ]);
    const chained = await (
      await toolsFor(other.id, asked)
    ).call('spark_sub_chats', { pieces: [{ title: 'Half', task: 'Do half.' }] });
    expect(chained.text).toBe(NOT_FROM_ANOTHER_CHAT);
    expect(await subChatsOf(t, other.id)).toEqual([]);
  });
});
