import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createConversation, sendUserMessage } from '../src/persistence/conversations.ts';
import type { Lease } from '../src/persistence/jobs.ts';
import { listen, type NotificationListener } from '../src/persistence/notifications.ts';
import {
  dispatchRunSignal,
  onRunSignal,
  RUN_SIGNAL_CHANNEL,
} from '../src/persistence/run-signals.ts';
import { requestCancel } from '../src/persistence/runs.ts';
import type { TurnDeps } from '../src/workflow/agent-turn.ts';
import { watchModeRequests } from '../src/workflow/mode-requests.ts';
import { startControl } from '../src/workflow/run-control.ts';
import { createTestDb, eventually, testDatabaseUrl, type TestDb } from './support.ts';

const SLOW_POLL_MS = 60_000;

let t: TestDb;
let listener: NotificationListener;

beforeEach(async () => {
  t = await createTestDb();
  listener = await listen(testDatabaseUrl(), RUN_SIGNAL_CHANNEL, dispatchRunSignal);
});

afterEach(async () => {
  await listener.close();
  await t.cleanup();
});

async function runningDoTurn() {
  const conversation = await createConversation(t.db, t.workspaceId, randomUUID());
  const sent = await sendUserMessage(
    t.db,
    conversation.id,
    { id: randomUUID(), content: 'Fix the build' },
    { provider: 'fake' },
  );
  await t.db.query(`UPDATE runs SET status = 'running', mode = 'do' WHERE id = $1`, [sent.run.id]);
  return sent.run.id;
}

function control(runId: string, cancelPollMs = SLOW_POLL_MS) {
  const deps = { db: t.db, leaseSeconds: 3600, cancelPollMs } as TurnDeps;
  const lease = { runId, jobId: randomUUID(), token: randomUUID() } as Lease;
  return startControl(deps, lease);
}

describe('run signals', () => {
  it('stops a turn when cancel is requested, without waiting for the slow poll', async () => {
    const runId = await runningDoTurn();
    const running = control(runId);
    try {
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(running.signal.aborted).toBe(false);
      await requestCancel(t.db, runId);
      await eventually(async () => (running.signal.aborted ? true : undefined));
      expect(running.reason()).toBe('cancelled');
    } finally {
      running.dispose();
    }
  });

  it('stops a turn whose cancel was requested before it started watching', async () => {
    const runId = await runningDoTurn();
    await requestCancel(t.db, runId);
    const running = control(runId);
    try {
      await eventually(async () => (running.signal.aborted ? true : undefined));
      expect(running.reason()).toBe('cancelled');
    } finally {
      running.dispose();
    }
  });

  it('still stops through the poll when no signal arrives', async () => {
    await listener.close();
    const runId = await runningDoTurn();
    const running = control(runId, 20);
    try {
      await requestCancel(t.db, runId);
      await eventually(async () => (running.signal.aborted ? true : undefined));
    } finally {
      running.dispose();
    }
  });

  it('tells a mode watcher about a requested mode once, and nothing after dispose', async () => {
    const runId = await runningDoTurn();
    const watch = watchModeRequests(t.db, runId, SLOW_POLL_MS);
    const seen: string[] = [];
    watch.subscribe((mode) => seen.push(mode));
    await new Promise((resolve) => setTimeout(resolve, 50));
    await t.db.query(`UPDATE runs SET requested_mode = 'acceptEdits' WHERE id = $1`, [runId]);
    await eventually(async () => (seen.length > 0 ? true : undefined));
    await t.db.query(`UPDATE runs SET requested_mode = 'acceptEdits' WHERE id = $1`, [runId]);
    dispatchRunSignal(runId);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(seen).toEqual(['acceptEdits']);
    watch.dispose();
    await t.db.query(`UPDATE runs SET requested_mode = 'plan' WHERE id = $1`, [runId]);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(seen).toEqual(['acceptEdits']);
  });

  it('forgets a listener when it unsubscribes', () => {
    let calls = 0;
    const off = onRunSignal('run-x', () => calls++);
    dispatchRunSignal('run-x');
    off();
    dispatchRunSignal('run-x');
    expect(calls).toBe(1);
  });
});
