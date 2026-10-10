import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Worker } from '../src/workflow/worker.ts';
import { planStandInTurn } from './chat-plan-support.ts';
import { FAKE_PLAN_COMMAND } from './fake-acp-plans.ts';
import { createTestDb, type TestDb } from './support.ts';
import { driveToEnd, gitRepo, openChat, removeRepo, sendMessage } from './turn-support.ts';
import { connectAgents, startTurnWorker } from './turn-worker.ts';

let t: TestDb;
let root: string;
let worker: Worker;
let conversationId: string;

beforeEach(async () => {
  t = await createTestDb();
  root = await gitRepo();
  await connectAgents(t);
  worker = startTurnWorker(t, { runTurn: planStandInTurn });
  conversationId = await openChat(t, { root });
});

afterEach(async () => {
  await worker.stop();
  await t.cleanup();
  await removeRepo(root);
});

async function planTurnIn(agentMode: string) {
  const runId = await sendMessage(
    t,
    conversationId,
    '/plan Add CSV export #nativeplan #plancommand',
    { permission: 'do', agentMode },
  );
  const { run, asked } = await driveToEnd(t, conversationId, runId);
  const { rows } = await t.db.query<{ status: string; decided_by: string | null }>(
    `SELECT status, decided_by FROM approvals
     WHERE run_id = $1 AND kind = 'execute' ORDER BY created_at`,
    [runId],
  );
  return {
    run,
    cards: asked.map((card) => card.title),
    commands: rows.map((row) => [row.status, row.decided_by]),
  };
}

describe('a command the agent asks for while it plans', { timeout: 120_000 }, () => {
  it('runs without a card when it changes no files and the chat is set to Bypass permissions', async () => {
    const { run, cards, commands } = await planTurnIn('bypassPermissions');

    expect(run.status).toBe('succeeded');
    expect(cards).not.toContain(FAKE_PLAN_COMMAND);
    expect(commands).toEqual([['allowed', 'level']]);
  });

  it('asks on a card in a chat set to Manual, before the plan approval', async () => {
    const { run, cards, commands } = await planTurnIn('default');

    expect(run.status).toBe('succeeded');
    expect(cards).toEqual([FAKE_PLAN_COMMAND, 'Approve Plan']);
    expect(commands).toEqual([['allowed', 'user']]);
  });
});
