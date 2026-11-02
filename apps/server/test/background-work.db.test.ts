import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  EventType,
  STOPPED_BY_QUIT,
  SUBAGENTS_ACTIVITY,
  type RunEvent,
} from '@spark-outpost/contracts';
import { createAcpProvider } from '../src/agents/acp/acp-provider.ts';
import { agentDefinitions } from '../src/agents/acp/agents.ts';
import { addToQueue, listQueue } from '../src/persistence/chat-queue.ts';
import {
  createConversation,
  getConversationDetail,
  listConversations,
  sendUserMessage,
} from '../src/persistence/conversations.ts';
import { getMemberMessage } from '../src/persistence/member-messages.ts';
import { getRun } from '../src/persistence/runs.ts';
import { sendNow } from '../src/workflow/queue-drain.ts';
import { ParkedTurns } from '../src/workflow/parked-turns.ts';
import { BACKGROUND_OUTCOME_MESSAGE, recoverExpiredLeases } from '../src/workflow/recovery.ts';
import { stopRun } from '../src/workflow/stop-run.ts';
import { startWorker, type Worker } from '../src/workflow/worker.ts';
import { expectConformantRun, storedEvents } from './agui-conformance.ts';
import { FAKE_ACP_LAUNCH } from './fake-acp-support.ts';
import { FAKE_AGENT_MODES } from './fake-agent-modes.ts';
import { expireLeases } from './interruption-support.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

let t: TestDb;
let worker: Worker | null = null;

function begin(leaseSeconds = 30) {
  const provider = createAcpProvider({
    definition: { ...agentDefinitions.claude, name: 'Fake', ...FAKE_AGENT_MODES },
    launch: FAKE_ACP_LAUNCH,
  });
  worker = startWorker({
    db: t.db,
    providers: new Map([['claude', provider]]),
    leaseSeconds,
    parked: new ParkedTurns(),
    pollMs: 20,
    cancelPollMs: 20,
  });
}

beforeEach(async () => {
  t = await createTestDb();
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
    { provider: 'claude' },
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

const WAITING = 'Waiting on 1 background agent';

const backgroundWaits = (events: readonly RunEvent[]) =>
  events.flatMap((event) =>
    event.type === EventType.ACTIVITY_SNAPSHOT && event.activityType === SUBAGENTS_ACTIVITY
      ? [event.content]
      : [],
  );

describe('a Claude chat whose turn ends with background work running', { timeout: 40_000 }, () => {
  it('stays running while it waits, then records the agent continuing on its own', async () => {
    begin();
    const { conversationId, runId } = await send('#background');
    expect((await settled(runId)).status).toBe('succeeded');
    await expectConformantRun(t.db, runId);

    const events = await storedEvents(t.db, runId);
    expect(backgroundWaits(events)).toEqual([
      { waitingOn: 1 },
      { waitingOn: 1, background: { agents: 1, tasks: 0, names: ['Schema'] } },
      { waitingOn: 0 },
    ]);
    const detail = await getConversationDetail(t.db, conversationId);
    expect(detail?.messages.at(-1)?.content).toBe(
      "Started the schema agent. I'll send the write-up once it reports.\n\nSchema finished: turns live in events.",
    );
    expect(detail?.subagents?.[runId]).toEqual([
      expect.objectContaining({ id: 'bg-1', name: 'Schema', state: 'done' }),
    ]);
    const run = detail?.runs.find((candidate) => candidate.id === runId);
    expect(run?.usage?.tokens?.total).toBe(280);
    expect((await latestRun(conversationId))?.waitingOn).toBeUndefined();
  });

  it('shows the wait instead of Done, and Stop ends the background work with the run', async () => {
    begin();
    const { conversationId, runId } = await send('#backgroundforever');
    await eventually(async () => (await latestRun(conversationId))?.step === WAITING, 20_000);
    expect(await latestRun(conversationId)).toMatchObject({
      status: 'running',
      waitingOn: 1,
      background: { agents: 1, tasks: 0, names: ['Schema'] },
    });

    await stopRun(t.db, runId);
    expect((await settled(runId)).status).toBe('cancelled');
    await expectConformantRun(t.db, runId);
    expect((await latestRun(conversationId))?.background).toBeUndefined();
  });

  it('sends a message written during the wait to the same session instead of queueing it', async () => {
    begin();
    const { conversationId, runId } = await send('#backgroundforever');
    await eventually(async () => (await latestRun(conversationId))?.step === WAITING, 20_000);
    const id = randomUUID();
    const target = async () => ({ provider: 'claude' });
    expect(await sendNow(t.db, conversationId, { id, content: 'Any news?' }, target)).toBe(
      'steering',
    );
    await eventually(async () => {
      const text = (await storedEvents(t.db, runId))
        .map((event) => (event.type === EventType.TEXT_MESSAGE_CONTENT ? event.delta : ''))
        .join('');
      return text.includes('Any news?') ? text : null;
    }, 20_000);
    expect(await listQueue(t.db, conversationId)).toEqual([]);
    expect((await getMemberMessage(t.db, id))?.status).toBe('delivered');
    await eventually(async () => (await latestRun(conversationId))?.step === WAITING, 20_000);
    expect((await getRun(t.db, runId))?.status).toBe('running');
    await stopRun(t.db, runId);
    await settled(runId);
  });

  it('hands the user’s queued messages to the agent once it only waits, in order', async () => {
    const { conversationId, runId } = await send('#backgroundforever');
    const queued = async (content: string, origin?: 'assistant') => {
      const id = randomUUID();
      await addToQueue(t.db, conversationId, { id, content, ...(origin ? { origin } : {}) });
      return id;
    };
    const first = await queued('Queued first');
    const fromAsk = await queued('From Ask Spark', 'assistant');
    const second = await queued('Queued second');
    begin();

    const text = await eventually(async () => {
      const said = (await storedEvents(t.db, runId))
        .map((event) => (event.type === EventType.TEXT_MESSAGE_CONTENT ? event.delta : ''))
        .join('');
      return said.includes('Queued second') ? said : null;
    }, 20_000);
    expect(text.indexOf('Queued first')).toBeLessThan(text.indexOf('Queued second'));
    expect((await listQueue(t.db, conversationId)).map((item) => item.id)).toEqual([fromAsk]);
    for (const id of [first, second]) {
      expect((await getMemberMessage(t.db, id))?.status).toBe('delivered');
    }
    expect((await getRun(t.db, runId))?.status).toBe('running');
    await stopRun(t.db, runId);
    await settled(runId);
  });

  it('lets other chats run while it waits', async () => {
    begin();
    const waiting = await send('#backgroundforever');
    await eventually(
      async () => (await latestRun(waiting.conversationId))?.step === WAITING,
      20_000,
    );
    const other = await send('Hi');
    expect((await settled(other.runId)).status).toBe('succeeded');
    expect((await getRun(t.db, waiting.runId))?.status).toBe('running');
    await stopRun(t.db, waiting.runId);
    await settled(waiting.runId);
  });

  it('stops a turn waiting on endless background work at once on Quit, and keeps its session', async () => {
    begin();
    const { conversationId, runId } = await send('#backgroundforever');
    await eventually(async () => (await latestRun(conversationId))?.step === WAITING, 20_000);

    const started = Date.now();
    await worker?.stop();
    worker = null;

    expect(Date.now() - started).toBeLessThan(10_000);
    const run = await getRun(t.db, runId);
    expect(run).toMatchObject({ status: 'cancelled', error: STOPPED_BY_QUIT });
    await expectConformantRun(t.db, runId);
    const sessions = await t.db.query<{ closed: boolean }>(
      'SELECT closed_at IS NOT NULL AS closed FROM provider_sessions WHERE conversation_id = $1',
      [conversationId],
    );
    expect(sessions.rows).toEqual([{ closed: false }]);
  });

  it('says it lost track of the background work when Spark stopped during the wait', async () => {
    begin(3);
    const { conversationId, runId } = await send('#backgroundforever');
    await eventually(async () => (await latestRun(conversationId))?.step === WAITING, 20_000);
    await expireLeases(t, runId);
    await worker?.stop();
    worker = null;
    await expireLeases(t, runId);
    expect(await recoverExpiredLeases(t.db)).toBe(1);
    const run = await getRun(t.db, runId);
    expect(run).toMatchObject({ status: 'outcome_unknown', error: BACKGROUND_OUTCOME_MESSAGE });
  });
});
