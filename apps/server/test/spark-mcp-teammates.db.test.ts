import { getApproval } from '../src/persistence/approvals.ts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SPARK_ACTION_OPTION, faceFromName } from '@spark-outpost/contracts';
import { insertChildRun, insertOrchestration } from '../src/persistence/orchestrations.ts';
import { createTeammate, listTeammates } from '../src/persistence/teammates.ts';
import {
  answerCard,
  confirmCard,
  recordedHooks,
  startSparkTools,
  type RecordedHooks,
  type SparkToolsHarness,
} from './spark-mcp-support.ts';
import { connectCliProvider, createTestDb, startChat, type TestDb } from './support.ts';

let t: TestDb;
let recorded: RecordedHooks;
let tools: SparkToolsHarness;

const pip = {
  name: 'Pip',
  role: 'Code reviewer',
  provider: null,
  model: null,
  agentMode: null,
  level: 'full-auto' as const,
  instructions: 'Point to the file and line.',
  projectIds: [],
};

beforeEach(async () => {
  t = await createTestDb();
  await connectCliProvider(t, 'claude');
  const { conversationId, runId } = await startChat(t, 'Set up a reviewer');
  recorded = recordedHooks();
  tools = await startSparkTools(t, { conversationId, runId, actions: recorded.hooks });
});

afterEach(async () => {
  recorded.stop();
  await tools.close();
  await t.cleanup();
});

describe('spark_sparks', () => {
  it('lists teammates with state, home chat, defaults and standing instructions', async () => {
    await createTeammate(t.db, t.workspaceId, pip);

    const result = (await tools.call('spark_sparks')).json<{
      sparks: Record<string, unknown>[];
      startersOffered: string[];
    }>();

    expect(result.sparks).toEqual([
      expect.objectContaining({
        name: 'Pip',
        role: 'Code reviewer',
        state: 'idle',
        stateLabel: 'Idle',
        homeChatId: null,
        chats: 0,
        standingInstructions: 'Point to the file and line.',
        defaults: expect.objectContaining({ autonomy: 'Full auto → PR' }),
      }),
    ]);
    expect(result.startersOffered).toEqual(['Wren · Docs writer', 'Bolt · Bug fixer']);
  });

  it('finds one Spark by name and explains a miss', async () => {
    await createTeammate(t.db, t.workspaceId, pip);
    const one = (await tools.call('spark_sparks', { spark: 'pip' })).json<{ sparks: unknown[] }>();
    expect(one.sparks).toHaveLength(1);
    const missing = await tools.call('spark_sparks', { spark: 'Nobody' });
    expect(missing.isError).toBe(true);
    expect(missing.text).toContain('Sparks: Pip');
  });
});

describe('jobs handed to a Spark by an @mention', () => {
  async function handedJob(reply: string) {
    const teammate = await createTeammate(t.db, t.workspaceId, pip);
    const chat = await startChat(t, '@Pip review the login change');
    await insertOrchestration(t.db, {
      runId: chat.runId,
      depth: 'direct',
      depthSource: 'user',
      risk: 'read-only',
    });
    const child = await insertChildRun(
      t.db,
      {
        parentRunId: chat.runId,
        role: 'spark',
        stepIndex: 0,
        attempt: 1,
        agentLabel: 'Pip · Code reviewer',
        provider: 'claude',
        model: null,
        effort: null,
        mode: 'chat',
        prompt: 'review',
        route: { name: 'Pip', spark: { id: teammate.id, role: 'Code reviewer', only: true } },
      },
      30,
    );
    await t.db.query(
      `INSERT INTO run_events (run_id, seq, type, payload)
       VALUES ($1, 1, 'TEXT_MESSAGE_CONTENT', $2)`,
      [child.runId, JSON.stringify({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm', delta: reply })],
    );
    await t.db.query(`UPDATE runs SET status = 'succeeded', finished_at = now() WHERE id = $1`, [
      child.runId,
    ]);
    return { teammate, chat };
  }

  it('shows which message went to which Spark and the Spark’s full reply', async () => {
    const { chat } = await handedJob('Two findings in login.ts:12 and :40.');

    const read = (await tools.call('spark_chat', { chat: chat.conversationId })).json<{
      messages: { items: { role: string; handedToSparks?: string[] }[] };
      sparkReplies: Record<string, unknown>[];
    }>();

    expect(read.messages.items[0]).toMatchObject({ role: 'user', handedToSparks: ['Pip'] });
    expect(read.sparkReplies).toEqual([
      expect.objectContaining({
        spark: 'Pip',
        role: 'Code reviewer',
        status: 'succeeded',
        mainAgentRan: false,
        text: 'Two findings in login.ts:12 and :40.',
      }),
    ]);
  });

  it('counts the jobs on the Spark', async () => {
    const { chat } = await handedJob('Looks fine.');

    const result = (await tools.call('spark_sparks', { spark: 'Pip' })).json<{
      sparks: { mentionJobs: Record<string, unknown> }[];
    }>();

    expect(result.sparks[0]!.mentionJobs).toMatchObject({
      total: 1,
      lastChatId: chat.conversationId,
    });
  });
});

describe('spark_create_spark', () => {
  it('creates nothing until the user confirms the card', async () => {
    await tools.call('spark_create_spark', {
      name: 'Wren',
      role: 'Docs writer',
      instructions: 'Short sentences.',
      autonomy: 'hands-off',
    });
    const card = await confirmCard(t);

    expect(card).toMatchObject({ kind: 'spark_action', title: 'Add this Spark? Wren' });
    expect(card.payload.sparkAction).toMatchObject({
      action: 'create_teammate',
      name: 'Wren',
      instructions: 'Short sentences.',
      level: 'hands-off',
    });
    expect(card.payload.sparkResult).toMatchObject({
      state: 'done',
      message: 'Added Wren to Sparks.',
    });
    expect(await listTeammates(t.db, t.workspaceId)).toEqual([
      expect.objectContaining({ name: 'Wren', faceAuto: true, face: faceFromName('Wren') }),
    ]);
    expect(JSON.stringify(recorded.audited)).toContain('spark/create_teammate');
  });

  it('keeps a face the agent names and stores it as picked', async () => {
    await tools.call('spark_create_spark', { name: 'Ada', face: { shape: 'sun', color: 'gold' } });
    await confirmCard(t);
    expect(await listTeammates(t.db, t.workspaceId)).toEqual([
      expect.objectContaining({ faceAuto: false, face: { shape: 'sun', color: 'gold' } }),
    ]);
  });

  it('leaves the roster alone when the user declines', async () => {
    await tools.call('spark_create_spark', { name: 'Bolt' });
    const card = await answerCard(t, SPARK_ACTION_OPTION.decline);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect((await getApproval(t.db, card.id))?.status).toBe('denied');
    expect(await listTeammates(t.db, t.workspaceId)).toEqual([]);
  });

  it('refuses a duplicate name or an unconnected provider before showing a card', async () => {
    await createTeammate(t.db, t.workspaceId, pip);
    expect((await tools.call('spark_create_spark', { name: 'pip' })).isError).toBe(true);
    const codex = await tools.call('spark_create_spark', { name: 'Ada', provider: 'codex' });
    expect(codex.text).toContain('Connect codex');
  });
});

describe('spark_update_spark', () => {
  it('shows only real changes on the card and saves them once confirmed', async () => {
    await createTeammate(t.db, t.workspaceId, pip);
    await tools.call('spark_update_spark', {
      spark: 'Pip',
      role: 'Code reviewer',
      instructions: 'Also check tests.',
    });
    const card = await confirmCard(t);

    expect(card.title).toBe('Change this Spark? Pip');
    expect(card.payload.sparkAction).toMatchObject({
      action: 'update_teammate',
      changed: ['instructions'],
      instructions: 'Also check tests.',
    });
    expect(card.payload.sparkResult).toMatchObject({
      state: 'done',
      output: { changed: ['instructions'] },
    });
    const [saved] = await listTeammates(t.db, t.workspaceId);
    expect(saved?.instructions).toBe('Also check tests.');
  });

  it('follows the new name for a name-based blob and can put a picked one back', async () => {
    await createTeammate(t.db, t.workspaceId, { ...pip, face: { shape: 'sun', color: 'gold' } });
    await tools.call('spark_update_spark', { spark: 'Pip', face: null, name: 'Juniper' });
    const card = await confirmCard(t);

    expect(card.payload.sparkAction).toMatchObject({
      faceAuto: true,
      face: faceFromName('Juniper'),
      changed: ['name', 'face'],
    });
    const [saved] = await listTeammates(t.db, t.workspaceId);
    expect(saved).toMatchObject({ name: 'Juniper', faceAuto: true, face: faceFromName('Juniper') });
  });

  it('says so when nothing would change', async () => {
    await createTeammate(t.db, t.workspaceId, pip);
    const same = await tools.call('spark_update_spark', { spark: 'Pip', role: 'Code reviewer' });
    expect(same.isError).toBe(true);
    expect(same.text).toContain('Nothing would change');
  });
});
