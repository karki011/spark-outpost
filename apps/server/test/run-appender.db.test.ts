import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createConversation, sendUserMessage } from '../src/persistence/conversations.ts';
import { claimNextJob } from '../src/persistence/jobs.ts';
import { LeaseLostError } from '../src/persistence/run-events.ts';
import { getRun, requestCancel } from '../src/persistence/runs.ts';
import type { Provider, ProviderOutput } from '../src/providers/provider.ts';
import { recoverExpiredLeases } from '../src/workflow/recovery.ts';
import { runAppender } from '../src/workflow/run-appender.ts';
import { runEvents } from '../src/workflow/run-events.ts';
import { startWorker, type Worker } from '../src/workflow/worker.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

let t: TestDb;
let worker: Worker | null = null;

beforeEach(async () => {
  t = await createTestDb();
});

afterEach(async () => {
  await worker?.stop();
  worker = null;
  await t.cleanup();
});

function start(provider: Provider) {
  worker = startWorker({
    db: t.db,
    providers: new Map([[provider.name, provider]]),
    leaseSeconds: 30,
    pollMs: 20,
    cancelPollMs: 20,
  });
}

async function send(provider: string) {
  const conversation = await createConversation(t.db, t.workspaceId, randomUUID());
  const sent = await sendUserMessage(
    t.db,
    conversation.id,
    { id: randomUUID(), content: 'Tell me a story' },
    { provider },
  );
  return sent.run.id;
}

async function settled(runId: string) {
  return eventually(async () => {
    const run = await getRun(t.db, runId);
    return run?.finishedAt ? run : null;
  });
}

interface StoredEvent {
  seq: number;
  type: string;
  delta: string | null;
  step: string | null;
}

async function stored(runId: string): Promise<StoredEvent[]> {
  const { rows } = await t.db.query<StoredEvent>(
    `SELECT seq, type, payload->>'delta' AS delta, payload->>'stepName' AS step
     FROM run_events WHERE run_id = $1 ORDER BY seq`,
    [runId],
  );
  return rows;
}

const words = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, index) => `${prefix}${index} `);

const said = (events: readonly StoredEvent[]) =>
  events
    .filter((event) => event.type === 'TEXT_MESSAGE_CONTENT')
    .map((event) => event.delta)
    .join('');

describe('streamed text in the worker', () => {
  it('stores every chunk in order around a step and matches the saved reply', async () => {
    const before = words('before', 120);
    const after = words('after', 120);
    start({
      name: 'scripted',
      async *run(): AsyncGenerator<ProviderOutput> {
        for (const delta of before) yield { kind: 'text_delta', delta };
        yield { kind: 'step_started', name: 'Edit file' };
        yield { kind: 'step_finished', name: 'Edit file' };
        for (const delta of after) yield { kind: 'text_delta', delta };
      },
    });
    const runId = await send('scripted');
    expect((await settled(runId)).status).toBe('succeeded');

    const events = await stored(runId);
    expect(events.map((event) => event.seq)).toEqual(events.map((_, index) => index + 1));
    const step = events.findIndex((event) => event.type === 'STEP_STARTED');
    expect(said(events.slice(0, step))).toBe(before.join(''));
    expect(said(events.slice(step))).toBe(after.join(''));
    expect(events.at(-2)?.type).toBe('TEXT_MESSAGE_END');

    const { rows } = await t.db.query<{ content: string }>(
      `SELECT content FROM messages WHERE run_id = $1 AND role = 'assistant'`,
      [runId],
    );
    expect(rows[0]?.content).toBe(said(events));
  });

  it('keeps the text said before a stop', async () => {
    const spoken = words('said', 80);
    let spoke = false;
    start({
      name: 'scripted',
      async *run(turn): AsyncGenerator<ProviderOutput> {
        for (const delta of spoken) yield { kind: 'text_delta', delta };
        spoke = true;
        await new Promise<void>((resolve) => {
          turn.signal.addEventListener('abort', () => resolve(), { once: true });
        });
      },
    });
    const runId = await send('scripted');
    await eventually(async () => spoke, 15_000);
    await requestCancel(t.db, runId);
    expect((await settled(runId)).status).toBe('cancelled');
    const events = await stored(runId);
    expect(said(events)).toBe(spoken.join(''));
    expect(events.at(-1)?.type).toBe('RUN_FINISHED');
  });
});

describe('buffered text and a lost lease', () => {
  it('adds nothing after recovery marked the run and reports the lost lease', async () => {
    const runId = await send('nobody');
    const lease = await claimNextJob(t.db, 30);
    expect(lease?.runId).toBe(runId);
    const append = runAppender(t.db, lease!, { flushMs: 20 });
    await append(runEvents.started({ runId, threadId: randomUUID() }), {
      transition: { status: 'running' },
    });
    await append(runEvents.textStart('message-1'));
    await append(runEvents.textContent('message-1', 'kept '));
    await eventually(async () => said(await stored(runId)) === 'kept ');

    await t.db.query(`UPDATE jobs SET lease_expires_at = now() - interval '1 second'`);
    await append(runEvents.textContent('message-1', 'late'));
    expect(await recoverExpiredLeases(t.db)).toBe(1);
    await delay(60);

    const events = await stored(runId);
    expect(said(events)).toBe('kept ');
    expect(events.at(-1)?.type).toBe('RUN_ERROR');
    await expect(append(runEvents.textEnd('message-1'))).rejects.toBeInstanceOf(LeaseLostError);
    expect((await getRun(t.db, runId))?.status).toBe('outcome_unknown');
  });
});
