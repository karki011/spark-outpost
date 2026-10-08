import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createConversation,
  getSummary,
  sendUserMessage,
} from '../src/persistence/conversations.ts';
import { withTransaction } from '../src/persistence/db.ts';
import { nativeTerminalRow } from '../src/persistence/native-terminals.ts';
import {
  acceptNativeEvent,
  appendNativeRun,
  finishNativeRun,
  recoverNativeTerminals,
  reserveNativeTerminalLaunch,
  setNativeRun,
  setNativeTerminalState,
} from '../src/persistence/native-terminal-turns.ts';
import { runEvents } from '../src/workflow/run-events.ts';
import { createTestDb, type TestDb } from './support.ts';
import { stopRun } from '../src/workflow/stop-run.ts';
import { addToQueue } from '../src/persistence/chat-queue.ts';
import { resolveRunTarget } from '../src/api/run-target.ts';

let t: TestDb;
beforeEach(async () => {
  t = await createTestDb();
});
afterEach(async () => {
  await t.cleanup();
});

async function seed() {
  const conversationId = randomUUID();
  await createConversation(t.db, t.workspaceId, conversationId, {
    sessionType: 'terminal',
    terminalProvider: 'claude',
  });
  const message = { id: randomUUID(), content: 'Inspect this project' };
  const target = { provider: 'claude', agentMode: 'plan', permission: 'ask' };
  const sent = await sendUserMessage(t.db, conversationId, message, target);
  const reservation = {
    id: randomUUID(),
    conversationId,
    provider: 'claude' as const,
    cwd: '/tmp/spark-native-test',
    label: 'Claude Code',
    runId: sent.run.id,
    messageId: sent.message.id,
    resume: false,
    observation: 'hooks' as const,
    reason: null,
  };
  return { conversationId, message, target, sent, reservation };
}

describe('native terminal persistence', () => {
  it('keeps terminal turns out of the ACP worker queue and deduplicates the seed message', async () => {
    const { conversationId, message, target, sent } = await seed();
    const duplicate = await sendUserMessage(t.db, conversationId, message, target);
    expect(duplicate.run.id).toBe(sent.run.id);
    expect((await t.db.query('SELECT * FROM jobs WHERE run_id = $1', [sent.run.id])).rowCount).toBe(
      0,
    );
    expect(await getSummary(t.db, conversationId)).toMatchObject({
      sessionType: 'terminal',
      terminal: null,
    });
  });

  it('allows an empty draft to choose Terminal and refuses changing a started session', async () => {
    const id = randomUUID();
    await createConversation(t.db, t.workspaceId, id);
    await withTransaction(t.db, (client) =>
      createConversation(client, t.workspaceId, id, {
        sessionType: 'terminal',
        terminalProvider: 'codex',
      }),
    );
    expect(await getSummary(t.db, id)).toMatchObject({ sessionType: 'terminal' });
    await sendUserMessage(
      t.db,
      id,
      { id: randomUUID(), content: 'Read this' },
      { provider: 'codex', agentMode: 'read-only' },
    );
    await expect(
      withTransaction(t.db, (client) =>
        createConversation(client, t.workspaceId, id, { sessionType: 'chat' }),
      ),
    ).rejects.toThrow('Start a new session');
    expect(await getSummary(t.db, id)).toMatchObject({ sessionType: 'terminal' });
  });

  it('reserves only one process launch for simultaneous requests', async () => {
    const { reservation } = await seed();
    const results = await Promise.allSettled([
      reserveNativeTerminalLaunch(t.db, reservation),
      reserveNativeTerminalLaunch(t.db, { ...reservation, id: randomUUID() }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect((await t.db.query('SELECT * FROM native_terminal_sessions')).rowCount).toBe(1);
  });

  it('starts a native run once, accepts metadata once and prevents stale generation writes', async () => {
    const { reservation, sent, conversationId } = await seed();
    const row = await reserveNativeTerminalLaunch(t.db, reservation);
    const fence = { id: row.id, generation: row.generation };
    const runFence = { ...fence, runId: sent.run.id };
    expect(await setNativeRun(t.db, runFence)).toBe(true);
    expect(await setNativeRun(t.db, runFence)).toBe(true);
    const eventId = randomUUID();
    expect(await acceptNativeEvent(t.db, { ...fence, eventId })).toBe(true);
    expect(await acceptNativeEvent(t.db, { ...fence, eventId })).toBe(false);
    expect(
      await setNativeTerminalState(t.db, {
        ...fence,
        state: 'waiting_for_input',
        nativeSessionId: 'native-1',
      }),
    ).toBe(true);
    expect(await getSummary(t.db, conversationId)).toMatchObject({
      needsInput: true,
      terminal: { state: 'waiting_for_input' },
    });
    await appendNativeRun(
      t.db,
      runFence,
      runEvents.activity('terminal', 'terminal', { state: 'working' }),
    );
    await finishNativeRun(t.db, fence, 'succeeded');
    await setNativeTerminalState(t.db, { ...fence, state: 'exited' });
    expect(await appendNativeRun(t.db, runFence, runEvents.stepStarted('late'))).toBeNull();
    const resumed = await reserveNativeTerminalLaunch(t.db, {
      ...reservation,
      resume: true,
      runId: null,
      messageId: null,
    });
    expect(resumed.generation).toBe(row.generation + 1);
    expect(resumed.native_session_id).toBe('native-1');
    expect(await setNativeTerminalState(t.db, { ...fence, state: 'error' })).toBe(false);
    expect(await acceptNativeEvent(t.db, { ...fence, eventId: randomUUID() })).toBe(false);
    expect(
      (
        await t.db.query("SELECT * FROM run_events WHERE run_id = $1 AND type = 'RUN_STARTED'", [
          sent.run.id,
        ])
      ).rowCount,
    ).toBe(1);
  });

  it('does not resurrect ended sessions from a late callback or replay an ended launch', async () => {
    const { reservation } = await seed();
    const row = await reserveNativeTerminalLaunch(t.db, reservation);
    const fence = { id: row.id, generation: row.generation };
    await setNativeTerminalState(t.db, { ...fence, state: 'error' });
    expect(await setNativeTerminalState(t.db, { ...fence, state: 'working' })).toBe(false);
    expect(await acceptNativeEvent(t.db, { ...fence, eventId: randomUUID() })).toBe(false);
    await expect(reserveNativeTerminalLaunch(t.db, reservation)).rejects.toThrow('explicitly');
    await expect(
      reserveNativeTerminalLaunch(t.db, { ...reservation, resume: true }),
    ).rejects.toThrow('no native session');
  });

  it('marks host failures interrupted without placing recovery work in the queue', async () => {
    const { reservation, sent, conversationId } = await seed();
    const row = await reserveNativeTerminalLaunch(t.db, reservation);
    await setNativeRun(t.db, { id: row.id, generation: row.generation, runId: sent.run.id });
    await setNativeTerminalState(t.db, {
      id: row.id,
      generation: row.generation,
      state: 'working',
      nativeSessionId: 'resume-me',
    });
    await recoverNativeTerminals(t.db);
    await recoverNativeTerminals(t.db);
    expect(await nativeTerminalRow(t.db, conversationId)).toMatchObject({
      state: 'interrupted',
      active_run_id: null,
      native_session_id: 'resume-me',
    });
    expect(
      (await t.db.query('SELECT status FROM runs WHERE id = $1', [sent.run.id])).rows[0],
    ).toEqual({ status: 'outcome_unknown' });
    expect((await t.db.query('SELECT * FROM jobs')).rowCount).toBe(0);
    expect(
      (
        await t.db.query("SELECT * FROM run_events WHERE run_id = $1 AND type = 'RUN_ERROR'", [
          sent.run.id,
        ])
      ).rowCount,
    ).toBe(1);
    expect(await getSummary(t.db, conversationId)).toMatchObject({
      terminal: { resumeAvailable: true },
    });
  });

  it('cancels a queued native launch without an ACP job and refuses starting it afterward', async () => {
    const { reservation, sent } = await seed();
    const row = await reserveNativeTerminalLaunch(t.db, reservation);
    expect(await stopRun(t.db, sent.run.id)).toMatchObject({
      outcome: 'stopped',
      run: { status: 'cancelled' },
    });
    expect(
      await setNativeRun(t.db, { id: row.id, generation: row.generation, runId: sent.run.id }),
    ).toBe(false);
    expect((await t.db.query('SELECT * FROM jobs')).rowCount).toBe(0);
    expect(
      (
        await t.db.query("SELECT * FROM run_events WHERE run_id = $1 AND type = 'RUN_STARTED'", [
          sent.run.id,
        ])
      ).rowCount,
    ).toBe(1);
  });

  it('refuses Chat queues and ACP continuation targets for terminal sessions', async () => {
    const { conversationId } = await seed();
    await expect(
      addToQueue(t.db, conversationId, { id: randomUUID(), content: 'Run this later' }),
    ).rejects.toThrow('session’s terminal');
    await expect(
      resolveRunTarget(
        { db: t.db, workspaceId: t.workspaceId, fixedRunProvider: 'fake' },
        conversationId,
      ),
    ).rejects.toThrow('session’s terminal');
    expect((await t.db.query('SELECT * FROM chat_queue')).rowCount).toBe(0);
  });
});
