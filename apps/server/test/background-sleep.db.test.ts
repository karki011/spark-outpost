import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { STOPPED_BY_QUIT, waitingOnLabel } from '@spark-outpost/contracts';
import { createAcpProvider } from '../src/agents/acp/acp-provider.ts';
import { agentDefinitions } from '../src/agents/acp/agents.ts';
import {
  createConversation,
  getConversationDetail,
  listConversations,
  sendUserMessage,
} from '../src/persistence/conversations.ts';
import { getRun } from '../src/persistence/runs.ts';
import { childEnvironment } from '../src/setup/environment.ts';
import { ParkedTurns } from '../src/workflow/parked-turns.ts';
import { recoverExpiredLeases, SLEEP_OUTCOME_MESSAGE } from '../src/workflow/recovery.ts';
import { stopRun } from '../src/workflow/stop-run.ts';
import { startWorker, type Worker } from '../src/workflow/worker.ts';
import { expectConformantRun } from './agui-conformance.ts';
import { FAKE_ACP_LAUNCH } from './fake-acp-support.ts';
import { FAKE_AGENT_MODES } from './fake-agent-modes.ts';
import { expireLeases } from './interruption-support.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

let t: TestDb;
let worker: Worker | null = null;

function begin({ leaseSeconds = 30, sleepMs = 800 } = {}) {
  const provider = createAcpProvider({
    definition: { ...agentDefinitions.claude, name: 'Fake', ...FAKE_AGENT_MODES },
    launch: FAKE_ACP_LAUNCH,
    env: { ...childEnvironment(process.env), FAKE_ACP_SLEEP_MS: String(sleepMs) },
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

async function send(content: string, conversationId?: string) {
  const id = conversationId ?? (await createConversation(t.db, t.workspaceId, randomUUID())).id;
  const sent = await sendUserMessage(
    t.db,
    id,
    { id: randomUUID(), content },
    { provider: 'claude' },
  );
  return { conversationId: id, runId: sent.run.id };
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

async function asleep(conversationId: string) {
  return eventually(async () => {
    const run = await latestRun(conversationId);
    return run?.step?.startsWith('Sleeping until') ? run : null;
  }, 20_000);
}

async function runCount(conversationId: string) {
  return (await getConversationDetail(t.db, conversationId))?.runs.length ?? 0;
}

describe('a Claude chat whose agent sleeps until a wakeup', { timeout: 40_000 }, () => {
  it('shows when it wakes, holds the turn open, and records what it does once awake', async () => {
    begin({ sleepMs: 1_500 });
    const { conversationId, runId } = await send('#sleep');
    const sleeping = await asleep(conversationId);
    expect(sleeping).toMatchObject({ status: 'running', waitingOn: 1 });
    const wakesAt = sleeping.background?.wakesAt;
    expect(wakesAt).toBeGreaterThan(Date.now() - 2_000);
    expect(sleeping.step).toBe(waitingOnLabel(1, sleeping.background));

    const other = await send('Hi');
    expect((await settled(other.runId)).status).toBe('succeeded');
    expect((await getRun(t.db, runId))?.status).toBe('running');

    expect((await settled(runId)).status).toBe('succeeded');
    await expectConformantRun(t.db, runId);
    const detail = await getConversationDetail(t.db, conversationId);
    expect(detail?.messages.at(-1)?.content).toBe(
      'Sleeping until the build is done.\n\nAwake: the build is green.',
    );
    expect(detail?.runs).toHaveLength(1);
    expect((await latestRun(conversationId))?.background).toBeUndefined();
  });

  it('cancels the sleep on Stop, so nothing wakes later, and the next message picks up', async () => {
    begin({ sleepMs: 2_000 });
    const { conversationId, runId } = await send('#sleep');
    await asleep(conversationId);

    await stopRun(t.db, runId);
    expect((await settled(runId)).status).toBe('cancelled');
    await expectConformantRun(t.db, runId);
    await delay(2_500);
    expect(await runCount(conversationId)).toBe(1);

    const next = await send('Hi', conversationId);
    expect((await settled(next.runId)).status).toBe('succeeded');
    expect(await runCount(conversationId)).toBe(2);
  });

  it('stops a sleeping turn at once on Quit and keeps its session', async () => {
    begin();
    const { conversationId, runId } = await send('#sleeplong');
    await asleep(conversationId);

    const started = Date.now();
    await worker?.stop();
    worker = null;

    expect(Date.now() - started).toBeLessThan(10_000);
    expect(await getRun(t.db, runId)).toMatchObject({
      status: 'cancelled',
      error: STOPPED_BY_QUIT,
    });
    const sessions = await t.db.query<{ closed: boolean }>(
      'SELECT closed_at IS NOT NULL AS closed FROM provider_sessions WHERE conversation_id = $1',
      [conversationId],
    );
    expect(sessions.rows).toEqual([{ closed: false }]);
  });

  it('says the sleep ended when Spark stopped during it', async () => {
    begin({ leaseSeconds: 3 });
    const { conversationId, runId } = await send('#sleeplong');
    await asleep(conversationId);
    await expireLeases(t, runId);
    await worker?.stop();
    worker = null;
    await expireLeases(t, runId);
    expect(await recoverExpiredLeases(t.db)).toBe(1);
    expect(await getRun(t.db, runId)).toMatchObject({
      status: 'outcome_unknown',
      error: SLEEP_OUTCOME_MESSAGE,
    });
  });
});
