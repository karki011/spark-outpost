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
import { listQueue } from '../src/persistence/chat-queue.ts';
import { getMemberMessage } from '../src/persistence/member-messages.ts';
import { getRun } from '../src/persistence/runs.ts';
import { sendNow } from '../src/workflow/queue-drain.ts';
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

async function latestRun(conversationId: string) {
  const chats = await listConversations(t.db, t.workspaceId);
  return chats.find((chat) => chat.id === conversationId)?.latestRun ?? null;
}

const latestStep = async (conversationId: string) =>
  (await latestRun(conversationId))?.step ?? null;

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
    expect(rows[0]).toMatchObject({
      steps: [
        { name: 'Starting a subagent', done: true },
        { name: 'Read routes.ts', done: true },
        { name: 'Edit routes.ts', done: true },
        { name: '`pnpm test`', done: true },
      ],
      files: ['/work/app/src/routes.ts'],
      commands: ['pnpm test'],
      usage: { tokens: 3400, toolUses: 3, durationMs: 41_000 },
      message: 'Found 4 routes and moved them.',
    });
    expect(rows[0]?.summary).toBeUndefined();
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

  it('shows the chat as waiting on its sub-agents, counts them and stops them with the turn', async () => {
    const { conversationId, runId } = await send('#subagentshold');
    await eventually(
      async () => (await latestStep(conversationId)) === '2 of 2 agents working',
      20_000,
    );
    expect((await latestRun(conversationId))?.waitingOn).toBe(2);
    const live = await getConversationDetail(t.db, conversationId);
    expect(live?.subagents?.[runId]).toEqual([
      expect.objectContaining({ id: 'sub-1', state: 'working', step: 'Read routes.ts' }),
      expect.objectContaining({ id: 'sub-2', state: 'working', step: null }),
    ]);

    await stopRun(t.db, runId);
    expect((await settled(runId)).status).toBe('cancelled');
    await expectConformantRun(t.db, runId);
    const stopped = await getConversationDetail(t.db, conversationId);
    const rows = stopped?.subagents?.[runId] ?? [];
    expect(rows.map((row) => row.state)).toEqual(['cancelled', 'cancelled']);
    for (const row of rows) expect(row.endedAt).toBeGreaterThanOrEqual(row.startedAt!);
    expect((await latestRun(conversationId))?.waitingOn).toBeUndefined();
  });

  it('queues a message sent now instead of stopping a turn that only waits on sub-agents', async () => {
    const { conversationId, runId } = await send('#subagentshold');
    await eventually(async () => (await latestRun(conversationId))?.waitingOn === 2, 20_000);
    const id = randomUUID();
    const target = async () => ({ provider: 'codex' });
    expect(
      await sendNow(t.db, conversationId, { id, content: 'Also check the tests' }, target),
    ).toBe('steering');
    const queued = await eventually(async () => {
      const queue = await listQueue(t.db, conversationId);
      return queue.length > 0 ? queue : null;
    }, 20_000);
    expect(queued).toEqual([expect.objectContaining({ id, content: 'Also check the tests' })]);
    expect(await getMemberMessage(t.db, id)).toBeNull();
    expect((await getRun(t.db, runId))?.status).toBe('running');
    expect((await latestRun(conversationId))?.waitingOn).toBe(2);
    await stopRun(t.db, runId);
    await settled(runId);
  });

  it('hides the Title line of a message that more text follows in a later message', async () => {
    const { conversationId, runId } = await send('#heldtitle');
    expect((await settled(runId)).status).toBe('succeeded');
    const detail = await getConversationDetail(t.db, conversationId);
    expect(detail?.messages.at(-1)?.content).toBe(
      'I started two sub-agents.\n\nBoth are done, and every test passes after the routes moved.',
    );
  });

  it('leaves a chat without sub-agents as it was', async () => {
    const { conversationId, runId } = await send('Hi');
    expect((await settled(runId)).status).toBe('succeeded');
    const detail = await getConversationDetail(t.db, conversationId);
    expect(detail?.subagents).toBeUndefined();
    expect(waits(await storedEvents(t.db, runId))).toEqual([]);
  });
});
