import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EventType, OUTPOST_DRAFT_ACTIVITY, type RunEvent } from '@spark-outpost/contracts';
import { insertChildRun } from '../src/persistence/orchestrations.ts';
import { draftsOfChat } from '../src/persistence/outpost-drafts.ts';
import type { Provider } from '../src/providers/provider.ts';
import type { SparkToolDeps } from '../src/spark-mcp/deps.ts';
import { outpostDraftTool } from '../src/spark-mcp/tools/outpost-draft-tool.ts';
import { executeChildRun } from '../src/workflow/execute-run.ts';
import { linkProject, projectRow } from './outpost-tool-support.ts';
import { createTestDb, startChat, type TestDb } from './support.ts';

let t: TestDb;

beforeEach(async () => {
  t = await createTestDb();
});

afterEach(async () => {
  await t.cleanup();
});

const PROPOSAL = {
  title: 'Checkout',
  name: 'Orders launch',
  chats: [{ handle: 'api', title: 'Orders endpoint', project: 'shop', task: 'Add the endpoint.' }],
};

function proposingProvider(outcome: { error: unknown }): Provider {
  return {
    name: 'fake',
    async *run(turn) {
      const deps = { db: t.db } as unknown as SparkToolDeps;
      await outpostDraftTool
        .run(PROPOSAL, { deps, scope: turn.sparkScope! })
        .catch((error: unknown) => {
          outcome.error = error;
        });
      yield { kind: 'text_delta', delta: 'Proposed.' };
    },
  };
}

async function builderTurn(role: 'builder' | 'coordinator') {
  const chat = await startChat(t, 'split this story into sub-chats');
  await linkProject(t, chat.conversationId, await projectRow(t, 'shop'));
  await t.db.query(`UPDATE runs SET status = 'running' WHERE id = $1`, [chat.runId]);
  const lease = await insertChildRun(
    t.db,
    {
      parentRunId: chat.runId,
      role,
      stepIndex: 0,
      attempt: 1,
      agentLabel: 'Bolt',
      provider: 'fake',
      model: null,
      effort: null,
      mode: 'chat',
      prompt: 'Split the story.',
      route: { name: 'Bolt' },
    },
    30,
  );
  const outcome = { error: null as unknown };
  const shownInChat: RunEvent[] = [];
  const provider = proposingProvider(outcome);
  const result = await executeChildRun(
    { db: t.db, providers: new Map([[provider.name, provider]]), leaseSeconds: 30 },
    lease,
    {},
    async (event) => {
      shownInChat.push(event);
      return null;
    },
  );
  const drafts = await draftsOfChat(t.db, t.workspaceId, chat.conversationId);
  const lines = shownInChat.filter(
    (event) =>
      event.type === EventType.ACTIVITY_SNAPSHOT && event.activityType === OUTPOST_DRAFT_ACTIVITY,
  );
  return { chat, result, outcome, drafts, lines };
}

describe('a Builder run of a chat with a project', () => {
  it('proposes for the chat and shows the draft line in the chat’s own turn', async () => {
    const { chat, result, outcome, drafts, lines } = await builderTurn('builder');

    expect(outcome.error).toBeNull();
    expect(result.outcome).toBe('succeeded');
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ conversationId: chat.conversationId, runId: chat.runId });
    expect(lines).toHaveLength(1);
  });

  it('cannot propose as the Coordinator', async () => {
    const { outcome, drafts, lines } = await builderTurn('coordinator');

    expect(String(outcome.error)).toContain('not a piece, the Coordinator');
    expect(drafts).toEqual([]);
    expect(lines).toEqual([]);
  });
});
