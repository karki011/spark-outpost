import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addToQueue, listQueue } from '../src/persistence/chat-queue.ts';
import type { Lease } from '../src/persistence/jobs.ts';
import { loadOrchestration } from '../src/persistence/orchestrations.ts';
import { getRun } from '../src/persistence/runs.ts';
import { createFakeProvider, fakeReply } from '../src/providers/fake.ts';
import type { TurnResult } from '../src/workflow/agent-turn.ts';
import { finishRun } from '../src/workflow/execute-run.ts';
import { runAppender } from '../src/workflow/run-appender.ts';
import { runEvents } from '../src/workflow/run-events.ts';
import { loadRunInput } from '../src/workflow/run-input.ts';
import type { RunTurn, Worker, WorkerOptions } from '../src/workflow/worker.ts';
import { expectConformantRun } from './agui-conformance.ts';
import { createTestDb, eventTypes, eventually, type TestDb } from './support.ts';
import { driveToEnd, openChat, repliesOf, sendMessage } from './turn-support.ts';
import { startTurnWorker } from './turn-worker.ts';

let t: TestDb;
let worker: Worker | null = null;

beforeEach(async () => {
  t = await createTestDb();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await worker?.stop();
  worker = null;
  await t.cleanup();
});

interface Received {
  options: WorkerOptions;
  lease: Lease;
  statusWhenCalled: string | undefined;
}

type Scripted = Pick<TurnResult, 'outcome' | 'error' | 'text'>;

function scriptedTurn(script: Scripted, received: Received[] = []): RunTurn {
  return async (options, lease) => {
    const statusWhenCalled = (await getRun(options.db, lease.runId))?.status;
    received.push({ options, lease, statusWhenCalled });
    const input = await loadRunInput(options.db, lease.runId);
    const append = runAppender(options.db, lease);
    const messageId = randomUUID();
    await append(runEvents.started(input.identity), { transition: { status: 'running' } });
    await append(runEvents.textStart(messageId));
    await append(runEvents.textContent(messageId, script.text));
    await finishRun(append, input.identity, { ...script, messageId }, true);
  };
}

function start(runTurn?: RunTurn) {
  const provider = createFakeProvider({ stepMs: 0, wordMs: 0 });
  worker = startTurnWorker(t, {
    providers: new Map([[provider.name, provider]]),
    concurrency: 2,
    ...(runTurn ? { runTurn } : {}),
  });
}

async function send(text: string, conversationId?: string) {
  const chat = conversationId ?? (await openChat(t));
  const runId = await sendMessage(t, chat, text, { provider: 'fake' });
  return { conversationId: chat, runId };
}

describe('the worker without an injected turn', () => {
  it('runs the message the way it does today', async () => {
    start();
    const { conversationId, runId } = await send('Hello');

    const { run } = await driveToEnd(t, conversationId, runId);

    expect(run.status).toBe('succeeded');
    expect(await repliesOf(t, runId)).toEqual([fakeReply('Hello')]);
    expect(await loadOrchestration(t.db, runId)).not.toBeNull();
    const types = await eventTypes(t.db, runId);
    expect(types[0]).toBe('RUN_STARTED');
    expect(types.slice(-2)).toEqual(['TEXT_MESSAGE_END', 'RUN_FINISHED']);
  });
});

describe('the worker with an injected turn', () => {
  it('hands the leased run and its own options to the injected turn', async () => {
    const received: Received[] = [];
    start(scriptedTurn({ outcome: 'succeeded', error: null, text: 'Injected.' }, received));
    const { conversationId, runId } = await send('Hello');

    await driveToEnd(t, conversationId, runId);

    expect(received).toHaveLength(1);
    expect(received[0]!.lease.runId).toBe(runId);
    expect(received[0]!.lease.jobId).toEqual(expect.any(String));
    expect(received[0]!.options.db).toBe(t.db);
    expect(received[0]!.options.providers.has('fake')).toBe(true);
    expect(received[0]!.statusWhenCalled).toBe('queued');
  });

  it('records a finished turn as a succeeded run with its reply', async () => {
    start(scriptedTurn({ outcome: 'succeeded', error: null, text: 'Injected.' }));
    const { conversationId, runId } = await send('Hello');

    const { run } = await driveToEnd(t, conversationId, runId);

    expect(run).toMatchObject({ status: 'succeeded', error: null });
    expect(await repliesOf(t, runId)).toEqual(['Injected.']);
    expect(await loadOrchestration(t.db, runId)).toBeNull();
    expect((await eventTypes(t.db, runId)).slice(-2)).toEqual(['TEXT_MESSAGE_END', 'RUN_FINISHED']);
    await expectConformantRun(t.db, runId);
  });

  it('records a failed turn as a failed run with its error', async () => {
    start(scriptedTurn({ outcome: 'failed', error: 'The agent stopped.', text: 'Partly.' }));
    const { conversationId, runId } = await send('Hello');

    const { run } = await driveToEnd(t, conversationId, runId);

    expect(run).toMatchObject({ status: 'failed', error: 'The agent stopped.' });
    expect((await eventTypes(t.db, runId)).at(-1)).toBe('RUN_ERROR');
    await expectConformantRun(t.db, runId);
  });

  it('records a stopped turn as a cancelled run', async () => {
    start(scriptedTurn({ outcome: 'cancelled', error: null, text: 'Partly.' }));
    const { conversationId, runId } = await send('Hello');

    const { run } = await driveToEnd(t, conversationId, runId);

    expect(run.status).toBe('cancelled');
    await expectConformantRun(t.db, runId);
  });

  it('sends the next queued message after the injected turn ends', async () => {
    const received: Received[] = [];
    start(scriptedTurn({ outcome: 'succeeded', error: null, text: 'Injected.' }, received));
    const conversationId = await openChat(t);
    await addToQueue(t.db, conversationId, { id: randomUUID(), content: 'Second' });
    const { runId } = await send('First', conversationId);

    await driveToEnd(t, conversationId, runId);

    await eventually(async () => received.length === 2);
    expect(await listQueue(t.db, conversationId)).toEqual([]);
    const second = await loadRunInput(t.db, received[1]!.lease.runId);
    expect(second.prompt).toContain('Second');
  });

  it('logs a turn that throws and keeps taking runs', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const received: Received[] = [];
    const finishes = scriptedTurn({ outcome: 'succeeded', error: null, text: 'Fine.' }, received);
    let calls = 0;
    start(async (options, lease) => {
      calls += 1;
      if (calls === 1) throw new Error('boom');
      await finishes(options, lease);
    });
    const first = await send('First');
    await eventually(async () => logged.mock.calls.length > 0);
    const second = await send('Second');

    const { run } = await driveToEnd(t, second.conversationId, second.runId);

    expect(logged.mock.calls[0]?.[0]).toBe(`Run ${first.runId} crashed`);
    expect(run.status).toBe('succeeded');
    expect(received.map((entry) => entry.lease.runId)).toEqual([second.runId]);
  });
});
