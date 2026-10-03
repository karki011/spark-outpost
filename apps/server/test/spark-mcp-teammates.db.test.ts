import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SPARK_ACTION_OPTION } from '@spark-outpost/contracts';
import { createTeammate, listTeammates } from '../src/persistence/teammates.ts';
import {
  answerCard,
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

describe('spark_create_spark', () => {
  it('creates nothing until the user confirms the card', async () => {
    const call = tools.call('spark_create_spark', {
      name: 'Wren',
      role: 'Docs writer',
      instructions: 'Short sentences.',
      autonomy: 'hands-off',
    });
    const card = await answerCard(t, SPARK_ACTION_OPTION.confirm);
    const result = (await call).json<{ outcome: string; name: string }>();

    expect(card).toMatchObject({ kind: 'spark_action', title: 'Add this Spark? Wren' });
    expect(card.payload.sparkAction).toMatchObject({
      action: 'create_teammate',
      name: 'Wren',
      instructions: 'Short sentences.',
      level: 'hands-off',
    });
    expect(result).toMatchObject({ outcome: 'done', name: 'Wren' });
    expect((await listTeammates(t.db, t.workspaceId)).map((teammate) => teammate.name)).toEqual([
      'Wren',
    ]);
    expect(JSON.stringify(recorded.audited)).toContain('spark/create_teammate');
  });

  it('leaves the roster alone when the user declines', async () => {
    const call = tools.call('spark_create_spark', { name: 'Bolt' });
    await answerCard(t, SPARK_ACTION_OPTION.decline);
    expect((await call).json()).toMatchObject({ outcome: 'declined' });
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
    const call = tools.call('spark_update_spark', {
      spark: 'Pip',
      role: 'Code reviewer',
      instructions: 'Also check tests.',
    });
    const card = await answerCard(t, SPARK_ACTION_OPTION.confirm);
    const result = (await call).json<{ outcome: string; changed: string[] }>();

    expect(card.title).toBe('Change this Spark? Pip');
    expect(card.payload.sparkAction).toMatchObject({
      action: 'update_teammate',
      changed: ['instructions'],
      instructions: 'Also check tests.',
    });
    expect(result).toMatchObject({ outcome: 'done', changed: ['instructions'] });
    const [saved] = await listTeammates(t.db, t.workspaceId);
    expect(saved?.instructions).toBe('Also check tests.');
  });

  it('says so when nothing would change', async () => {
    await createTeammate(t.db, t.workspaceId, pip);
    const same = await tools.call('spark_update_spark', { spark: 'Pip', role: 'Code reviewer' });
    expect(same.isError).toBe(true);
    expect(same.text).toContain('Nothing would change');
  });
});
