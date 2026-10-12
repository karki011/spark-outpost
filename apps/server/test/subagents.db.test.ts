import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EventType, SUBAGENTS_ACTIVITY, type RunEvent } from '@spark-outpost/contracts';
import { createAcpProvider } from '../src/agents/acp/acp-provider.ts';
import { agentDefinitions } from '../src/agents/acp/agents.ts';
import {
  createConversation,
  getConversationDetail,
  listConversations,
  sendUserMessage,
} from '../src/persistence/conversations.ts';
import { getRun } from '../src/persistence/runs.ts';
import { stopRun } from '../src/workflow/stop-run.ts';
import { startWorker, type Worker } from '../src/workflow/worker.ts';
import { expectConformantRun, storedEvents } from './agui-conformance.ts';
import { FAKE_ACP_LAUNCH } from './fake-acp-support.ts';
import { FAKE_AGENT_MODES } from './fake-agent-modes.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

let t: TestDb;
let worker: Worker | null = null;

beforeEach(async () => {
  t = await createTestDb();
  const provider = createAcpProvider({
    definition: { ...agentDefinitions.codex, name: 'Fake', ...FAKE_AGENT_MODES },
    launch: FAKE_ACP_LAUNCH,
  });
  worker = startWorker({
    db: t.db,
    providers: new Map([['codex', provider]]),
    leaseSeconds: 30,
    concurrency: 1,
    pollMs: 20,
    cancelPollMs: 20,
  });
});

afterEach(async () => {
  await worker?.stop();
  worker = null;
  await t.cleanup();
});

async function send(content: string) {
  const conversation = await createConversation(t.db, t.workspaceId, randomUUID());
  const sent = await sendUserMessage(
    t.db,
    conversation.id,
    { id: randomUUID(), content },
    { provider: 'codex' },
  );
  return { conversationId: conversation.id, runId: sent.run.id };
}

async function settled(runId: string) {
  return eventually(async () => {
    const run = await getRun(t.db, runId);
    return run?.finishedAt ? run : null;
  }, 20_000);
}

async function latestStep(conversationId: string): Promise<string | null> {
  const chats = await listConversations(t.db, t.workspaceId);
  return chats.find((chat) => chat.id === conversationId)?.latestRun?.step ?? null;
}

const waits = (events: readonly RunEvent[]) =>
  events.flatMap((event) =>
    event.type === EventType.ACTIVITY_SNAPSHOT && event.activityType === SUBAGENTS_ACTIVITY
      ? [(event.content as { waitingOn: number }).waitingOn]
      : [],
  );

describe("an agent's own sub-agents in a chat turn", { timeout: 40_000 }, () => {
  it('records each sub-agent with its task, state, times and attributed steps', async () => {
    const { conversationId, runId } = await send('#subagents');
    expect((await settled(runId)).status).toBe('succeeded');
    await expectConformantRun(t.db, runId);
    const events = await storedEvents(t.db, runId);

    const attributed = events.flatMap((event) =>
      event.type === EventType.STEP_STARTED || event.type === EventType.TOOL_CALL_START
        ? [[event.type, event.subagentRunId ?? 'main']]
        : [],
    );
    expect(attributed).toContainEqual([EventType.STEP_STARTED, 'sub-1']);
    expect(attributed).toContainEqual([EventType.TOOL_CALL_START, 'sub-3']);
    expect(waits(events)).toEqual([1, 2, 3, 2, 1, 0]);

    const detail = await getConversationDetail(t.db, conversationId);
    const rows = detail?.subagents?.[runId] ?? [];
    expect(
      rows.map(({ id, name, task, parentId, state, step }) => ({
        id,
        name,
        task,
        parentId,
        state,
        step,
      })),
    ).toEqual([
      {
        id: 'sub-1',
        name: 'Explore',
        task: 'Find the routes',
        parentId: null,
        state: 'done',
        step: null,
      },
      {
        id: 'sub-2',
        name: 'Tests',
        task: 'Run the tests',
        parentId: null,
        state: 'failed',
        step: null,
      },
      {
        id: 'sub-3',
        name: 'Nested',
        task: 'Look deeper',
        parentId: 'sub-1',
        state: 'done',
        step: null,
      },
    ]);
    for (const row of rows) {
      expect(row.startedAt).toEqual(expect.any(Number));
      expect(row.endedAt).toBeGreaterThanOrEqual(row.startedAt!);
    }
    const reply = detail?.messages.at(-1)?.content ?? '';
    expect(reply).toContain('All done');
    expect(reply).not.toContain('child words');
    expect(detail?.activity[runId]?.map((step) => step.name)).toEqual(
      expect.arrayContaining(['Starting a subagent', 'Read routes.ts', 'Read tests.ts']),
    );
  });

  it('shows the chat as waiting on its sub-agents, and stops them with the turn', async () => {
    const { conversationId, runId } = await send('#subagentshold');
    await eventually(
      async () => (await latestStep(conversationId)) === 'Waiting on 2 sub-agents',
      20_000,
    );
    const live = await getConversationDetail(t.db, conversationId);
    expect(live?.subagents?.[runId]).toEqual([
      expect.objectContaining({ id: 'sub-1', state: 'working', step: 'Read routes.ts' }),
      expect.objectContaining({ id: 'sub-2', state: 'working', step: null }),
    ]);

    await stopRun(t.db, runId);
    expect((await settled(runId)).status).toBe('cancelled');
    await expectConformantRun(t.db, runId);
    const stopped = await getConversationDetail(t.db, conversationId);
    expect(stopped?.subagents?.[runId]?.map((row) => row.state)).toEqual([
      'cancelled',
      'cancelled',
    ]);
    expect(await latestStep(conversationId)).not.toBe('Waiting on 2 sub-agents');
  });

  it('leaves a chat without sub-agents as it was', async () => {
    const { conversationId, runId } = await send('Hi');
    expect((await settled(runId)).status).toBe('succeeded');
    const detail = await getConversationDetail(t.db, conversationId);
    expect(detail?.subagents).toBeUndefined();
    expect(waits(await storedEvents(t.db, runId))).toEqual([]);
  });
});
