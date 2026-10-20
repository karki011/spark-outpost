import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SPARK_ACTION_OPTION } from '@spark-outpost/contracts';
import { outpostNeeds } from '../src/outposts/outpost-availability.ts';
import {
  resolveChatSettings,
  saveCapabilities,
  updateChatSettings,
} from '../src/persistence/chat-settings.ts';
import { createProject } from '../src/projects/projects.ts';
import { FAKE_CLAUDE_MODES } from '../src/providers/fake.ts';
import {
  outpostStartTool,
  STORY_CHAT_CANNOT_START,
} from '../src/spark-mcp/tools/outpost-start-tool.ts';
import { DRAFT_FROM_REQUEST } from '../src/spark-mcp/tools/outpost-proposal.ts';
import { NOT_THE_CHATS_TURN } from '../src/spark-mcp/tools/outpost-turn.ts';
import { addMemberChat, createOutpostRow } from './outpost-fixtures.ts';
import {
  linkProject,
  memberWithTurn,
  requestStartedTurn,
  sparkRun,
  toolHarness,
} from './outpost-tool-support.ts';
import {
  answerCard,
  cardResult,
  chatAtLevel,
  pendingCard,
  recordedHooks,
  startSparkTools,
  type RecordedHooks,
  type SparkToolsHarness,
} from './spark-mcp-support.ts';
import { createTestDb, startChat, type TestDb } from './support.ts';

let t: TestDb;
let root: string;
let projectId: string;
let recorded: RecordedHooks;
let tools: SparkToolsHarness | null = null;

interface Started {
  outcome: string;
  draft: string;
  outpostId?: string;
  started?: number;
  next?: string;
}

function startArgs() {
  return {
    title: 'Read the docs',
    name: 'Docs split',
    chats: [
      { handle: 'api', title: 'Read api docs', project: projectId, task: 'Summarise api.md.' },
      { handle: 'guide', title: 'Read the guide', project: projectId, task: 'Summarise guide.md.' },
    ],
  };
}

beforeEach(async () => {
  t = await createTestDb();
  root = await realpath(await mkdtemp(join(tmpdir(), 'spark-start-tool-')));
  projectId = (await createProject(t.db, t.workspaceId, root)).project.id;
  recorded = recordedHooks();
});

afterEach(async () => {
  recorded.stop();
  await tools?.close();
  tools = null;
  await t.cleanup();
  await rm(root, { recursive: true, force: true });
});

async function leadIn(mode: string, message = 'Look at the docs') {
  const lead = await startChat(t, message);
  await linkProject(t, lead.conversationId, projectId);
  await chatAtLevel(t, lead.conversationId, 'full-auto');
  await saveCapabilities(t.db, t.workspaceId, {
    provider: 'claude',
    models: [],
    efforts: [],
    defaultModel: null,
    modes: FAKE_CLAUDE_MODES,
  });
  await updateChatSettings(t.db, lead.conversationId, { agentMode: mode });
  await t.db.query(`UPDATE runs SET provider = 'claude', used_mode = $2 WHERE id = $1`, [
    lead.runId,
    mode,
  ]);
  tools = await startSparkTools(t, { ...lead, actions: recorded.hooks });
  return lead;
}

async function call(): Promise<Started> {
  return (await tools!.call('spark_outpost_start', startArgs())).json<Started>();
}

async function count(table: string): Promise<number> {
  const { rows } = await t.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`);
  return rows[0]!.n;
}

async function memberChats(outpostId: string, leadId: string): Promise<string[]> {
  const { rows } = await t.db.query<{ conversation_id: string }>(
    'SELECT conversation_id FROM outpost_members WHERE outpost_id = $1 AND conversation_id <> $2',
    [outpostId, leadId],
  );
  return rows.map((row) => row.conversation_id);
}

const MODES = [
  ['plan', 'waiting_for_user'],
  ['default', 'waiting_for_user'],
  ['acceptEdits', 'waiting_for_user'],
  ['auto', 'done'],
  ['bypassPermissions', 'done'],
] as const;

describe('spark_outpost_start follows the agent mode', () => {
  it.each(MODES)('in %s: %s', async (mode, outcome) => {
    await leadIn(mode);
    const result = await call();
    expect(result.outcome).toBe(outcome);
    expect(await count('outposts')).toBe(outcome === 'done' ? 1 : 0);
    expect(await count('outpost_story_tasks')).toBe(outcome === 'done' ? 2 : 0);
    expect(recorded.audited).toContainEqual(
      expect.objectContaining({ method: 'spark/start_outpost' }),
    );
  });

  it('runs at once in Accept edits when the user’s message asked for it', async () => {
    await leadIn('acceptEdits', 'Split this into two parallel sub-chats and start them');
    expect((await call()).outcome).toBe('done');
  });

  it('starts the chats in the lead’s mode, marked as started by the agent, and says not to wait', async () => {
    const lead = await leadIn('auto');
    const result = await call();
    expect(result).toMatchObject({ outcome: 'done', started: 2 });
    expect(result.next).toContain('Do not poll');
    const chats = await memberChats(result.outpostId!, lead.conversationId);
    expect(chats).toHaveLength(2);
    for (const chat of chats) {
      expect((await resolveChatSettings(t.db, chat)).agentMode).toBe('auto');
    }
    const { rows } = await t.db.query<{ agent_started: boolean; from_user: boolean }>(
      `SELECT agent_started, from_user FROM outpost_posts WHERE kind = 'request'`,
    );
    expect(rows).toEqual([
      { agent_started: true, from_user: false },
      { agent_started: true, from_user: false },
    ]);
    const { rows: logged } = await t.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM run_protocol_log
       WHERE run_id = $1 AND method = 'spark/start_outpost'`,
      [lead.runId],
    );
    expect(logged[0]!.n).toBe(1);
  });

  it('starts on the card in Manual, as the user’s start, and Discard starts nothing', async () => {
    await leadIn('default');
    await call();
    const card = await pendingCard(t);
    expect(card.options.map((option) => option.name)).toEqual(['Start', 'Discard']);
    await answerCard(t, SPARK_ACTION_OPTION.confirm);
    const done = await cardResult(t, card.id);
    expect(done.payload.sparkResult).toMatchObject({
      state: 'done',
      message: 'Started outpost Docs split with 2 chats.',
    });
    const { rows } = await t.db.query<{ agent_started: boolean }>(
      `SELECT agent_started FROM outpost_posts WHERE kind = 'request'`,
    );
    expect(rows.every((row) => !row.agent_started)).toBe(true);
  });

  it('starts nothing when the card is discarded', async () => {
    await leadIn('default');
    await call();
    const card = await answerCard(t, SPARK_ACTION_OPTION.decline);
    expect((await cardResult(t, card.id)).status).toBe('denied');
    expect(await count('outposts')).toBe(0);
  });

  it('holds a proposed mode above the lead’s', async () => {
    await leadIn('acceptEdits');
    const args = startArgs();
    const over = { ...args, chats: [{ ...args.chats[0]!, agentMode: 'bypassPermissions' }] };
    const result = await tools!.call('spark_outpost_start', over);
    expect(result.isError).toBe(true);
    expect(await count('outpost_drafts')).toBe(0);
  });
});

describe('who may start sub-chats', () => {
  it('is never a Spark the chat handed a job to', async () => {
    const lead = await leadIn('auto');
    const spark = { conversationId: lead.conversationId, runId: await sparkRun(t, lead.runId) };
    const harness = toolHarness(t, spark);
    await expect(outpostStartTool.run(startArgs(), harness.context)).rejects.toThrow(
      NOT_THE_CHATS_TURN,
    );
  });

  it('is never a turn another chat’s request started', async () => {
    const outpostId = await createOutpostRow(t);
    const web = await memberWithTurn(t, outpostId, 'web');
    const api = { conversationId: await addMemberChat(t, outpostId, 'api'), handle: 'api' };
    const asked = await requestStartedTurn(t, outpostId, api, 'chat', web);
    const harness = toolHarness(t, asked);
    await expect(outpostStartTool.run(startArgs(), harness.context)).rejects.toThrow(
      DRAFT_FROM_REQUEST,
    );
    expect((await outpostNeeds(t.db, asked)).outpost_start).toBe(false);
  });

  it('is never a sub-chat of a story, which keeps the draft tool but not the start tool', async () => {
    const lead = await leadIn('auto');
    const result = await call();
    expect((await outpostNeeds(t.db, lead)).outpost_start).toBe(true);
    const [sub] = await memberChats(result.outpostId!, lead.conversationId);
    const turn = await requestStartedTurn(
      t,
      result.outpostId!,
      { conversationId: sub!, handle: 'api2' },
      'draft',
    );
    const needs = await outpostNeeds(t.db, turn);
    expect(needs).toMatchObject({ outpost_draft: true, outpost_start: false });
    const harness = toolHarness(t, turn);
    await expect(outpostStartTool.run(startArgs(), harness.context)).rejects.toThrow(
      STORY_CHAT_CANNOT_START,
    );
  });

  it('is an action tool with its own need', () => {
    expect(outpostStartTool.acts).toBe(true);
    expect(outpostStartTool.needs).toBe('outpost_start');
  });
});
