import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CONTINUE_MESSAGE } from '@spark-outpost/contracts';
import { createAcpProvider } from '../src/agents/acp/acp-provider.ts';
import { agentDefinitions } from '../src/agents/acp/agents.ts';
import { REOPENED_INTERRUPTED, freshAfterInterruption } from '../src/agents/acp/session-open.ts';
import {
  createConversation,
  getConversationDetail,
  sendUserMessage,
} from '../src/persistence/conversations.ts';
import { InterruptionError, findInterruption } from '../src/persistence/interruptions.ts';
import { getRun } from '../src/persistence/runs.ts';
import type { Provider } from '../src/providers/provider.ts';
import {
  CONTINUE_METHOD,
  START_FRESH_METHOD,
  continueInterruptedRun,
  startFreshAfterInterruption,
} from '../src/workflow/interruption-choice.ts';
import { CONTINUED_SESSION_METHOD } from '../src/workflow/continue-note.ts';
import { recoverExpiredLeases } from '../src/workflow/recovery.ts';
import { startWorker, type Worker } from '../src/workflow/worker.ts';
import { insertCommandApproval } from './approval-support.ts';
import { FAKE_ACP_LAUNCH } from './fake-acp-support.ts';
import { FAKE_AGENT_MODES } from './fake-agent-modes.ts';
import {
  auditMethods,
  expireLeases,
  fakePrompts,
  resumedSessionIds,
  stepNames,
  untilFinished,
  untilStatus,
} from './interruption-support.ts';
import { CLAUDE_MODELS, connectProviders } from './orchestration-support.ts';
import { createTestDb, eventually, type TestDb, underCurrent } from './support.ts';

const TARGET = {
  provider: 'claude',
  model: 'sonnet',
  effort: 'medium',
  permission: 'ask',
  level: 'hands-off',
} as const;
const NEVER_SWEEP_MS = 10 * 60_000;
const REQUEST = 'Tell me a long story about herons #stall';

let t: TestDb;
let worker: Worker;
let store: string;

function fakeClaude(): Provider {
  return createAcpProvider({
    definition: { ...agentDefinitions.claude, ...FAKE_AGENT_MODES },
    launch: FAKE_ACP_LAUNCH,
    cancelGraceMs: 2_000,
    env: {
      ...(process.env as Record<string, string>),
      FAKE_ACP_MODELS: JSON.stringify(CLAUDE_MODELS.map((model) => [model.id, model.label])),
      FAKE_ACP_SESSION_STORE: store,
      FAKE_ACP_SESSION_CAPABILITIES: JSON.stringify({ resume: {}, close: {} }),
    },
  });
}

function start(recoveryEveryMs = 40): void {
  worker = startWorker({
    db: t.db,
    providers: new Map([['claude', fakeClaude()]]),
    leaseSeconds: 30,
    concurrency: 2,
    pollMs: 20,
    cancelPollMs: 20,
    recoveryEveryMs,
  });
}

beforeEach(async () => {
  t = await createTestDb();
  store = mkdtempSync(join(tmpdir(), 'fake-acp-store-'));
  await connectProviders(t, false);
});

afterEach(async () => {
  await worker.stop();
  await t.cleanup();
  rmSync(store, { recursive: true, force: true });
});

async function midTurn(content = REQUEST) {
  const { id } = await createConversation(t.db, t.workspaceId, randomUUID());
  await t.db.query(`UPDATE conversations SET model_routing = 'pinned' WHERE id = $1`, [id]);
  const sent = await sendUserMessage(t.db, id, { id: randomUUID(), content }, TARGET);
  worker.wake();
  await eventually(async () => {
    const { rows } = await t.db.query(
      `SELECT 1 FROM run_events WHERE run_id = $1 AND type = 'TEXT_MESSAGE_CONTENT'`,
      [sent.run.id],
    );
    return rows.length > 2 ? true : null;
  }, 20_000);
  return { conversationId: id, runId: sent.run.id };
}

async function interrupted(content = REQUEST) {
  const turn = await midTurn(content);
  await expireLeases(t, turn.runId);
  await untilStatus(t, turn.runId, 'outcome_unknown');
  await worker.idle();
  return turn;
}

function proceed(runId: string, messageId: string = randomUUID()) {
  return continueInterruptedRun(t.db, t.workspaceId, runId, messageId, TARGET);
}

async function sessions(conversationId: string) {
  const { rows } = await t.db.query<{
    session_id: string;
    close_reason: string | null;
    last_reply_hash: string | null;
  }>(
    `SELECT session_id, close_reason, last_reply_hash FROM provider_sessions
     WHERE conversation_id = $1 ORDER BY created_at`,
    [conversationId],
  );
  return rows;
}

async function rewriteRequest(runId: string, content: string): Promise<void> {
  await t.db.query(
    'UPDATE messages SET content = $2 WHERE id = (SELECT user_message_id FROM runs WHERE id = $1)',
    [runId, content],
  );
}

async function continuations(runId: string): Promise<number> {
  const { rows } = await t.db.query<{ count: number }>(
    'SELECT count(*)::int AS count FROM runs WHERE continues_run_id = $1',
    [runId],
  );
  return rows[0]!.count;
}

describe('Continue from here after a lease expired mid-turn', { timeout: 90_000 }, () => {
  it('offers the card only for the latest interrupted run that nobody decided on', async () => {
    start();
    const turn = await midTurn();
    expect(await findInterruption(t.db, turn.conversationId)).toBeNull();
    await expireLeases(t, turn.runId);
    const run = await untilStatus(t, turn.runId, 'outcome_unknown');
    expect(run.error).toContain('Nothing was retried automatically.');
    const detail = await getConversationDetail(t.db, turn.conversationId);
    expect(detail?.interruption).toMatchObject({ runId: turn.runId, blocked: null });
    expect(detail?.interruption?.stoppedAt).toBe(run.finishedAt);
    expect(await sessions(turn.conversationId)).toMatchObject([
      { close_reason: null, last_reply_hash: null },
    ]);
  });

  it('reopens the stored session and sends the interruption note', async () => {
    start();
    const turn = await interrupted();
    const [before] = await sessions(turn.conversationId);
    const sent = await proceed(turn.runId);
    expect(sent.message.content).toBe(CONTINUE_MESSAGE);
    expect(sent.run).toMatchObject({ continuesRunId: turn.runId, status: 'queued' });
    worker.wake();
    const done = await untilFinished(t, sent.run.id);
    expect(done.status).toBe('succeeded');

    expect(await resumedSessionIds(t, sent.run.id)).toEqual([before!.session_id]);
    expect(await stepNames(t, sent.run.id)).toContain(REOPENED_INTERRUPTED);
    const prompts = fakePrompts(store, before!.session_id);
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain('## Your previous turn was interrupted');
    expect(prompts[1]).toContain(`Original request:\n${REQUEST}`);
    expect(prompts[1]).toContain('Do not rerun commands blindly');
    expect(prompts[1]).not.toContain('Earlier messages');
    const after = await sessions(turn.conversationId);
    expect(after).toHaveLength(1);
    expect(after[0]!.last_reply_hash).not.toBeNull();

    expect(await auditMethods(t, turn.runId)).toContain(CONTINUE_METHOD);
    expect(await auditMethods(t, sent.run.id)).toContain(CONTINUED_SESSION_METHOD);
    expect((await getRun(t.db, turn.runId))?.interruptionChoice).toBe('continue');
    expect(await findInterruption(t.db, turn.conversationId)).toBeNull();
    const summary = (await getConversationDetail(t.db, turn.conversationId))?.conversation;
    expect(summary?.latestRun).toMatchObject({ id: sent.run.id, status: 'succeeded' });
  });

  it('keeps the provider, model, effort and level the chat has, like any send', async () => {
    start();
    const turn = await interrupted();
    const sent = await proceed(turn.runId);
    const original = await getRun(t.db, turn.runId);
    expect(sent.run).toMatchObject({
      provider: original!.provider,
      model: original!.model,
      effort: original!.effort,
      mode: original!.mode,
      level: original!.level,
    });
  });

  it('starts one continued run for a double click, two windows and a retry', async () => {
    start(NEVER_SWEEP_MS);
    const turn = await midTurn();
    await expireLeases(t, turn.runId);
    await expect(proceed(turn.runId)).rejects.toMatchObject({ refusal: 'settling' });
    expect(await recoverExpiredLeases(t.db)).toBe(1);
    await worker.idle();

    const clientId = randomUUID();
    const clicks = await Promise.all([
      proceed(turn.runId, clientId),
      proceed(turn.runId, clientId),
      proceed(turn.runId),
      proceed(turn.runId),
    ]);
    expect(new Set(clicks.map((click) => click.run.id)).size).toBe(1);
    expect((await proceed(turn.runId, clientId)).run.id).toBe(clicks[0]!.run.id);
    expect(await continuations(turn.runId)).toBe(1);
    const audits = (await auditMethods(t, turn.runId)).filter(
      (method) => method === CONTINUE_METHOD,
    );
    expect(audits).toHaveLength(1);
    await untilFinished(t, clicks[0]!.run.id);
  });

  it.runIf(underCurrent)('refuses once a newer message started a turn', async () => {
    start();
    const turn = await interrupted();
    await rewriteRequest(turn.runId, 'Tell me a long story about herons');
    const next = await sendUserMessage(
      t.db,
      turn.conversationId,
      { id: randomUUID(), content: 'Never mind, what time is it?' },
      TARGET,
    );
    expect(await findInterruption(t.db, turn.conversationId)).toBeNull();
    const refused = await proceed(turn.runId).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(InterruptionError);
    expect(refused).toMatchObject({ refusal: 'newer_turn' });
    expect(await continuations(turn.runId)).toBe(0);
    worker.wake();
    await untilFinished(t, next.run.id);
    expect(await stepNames(t, next.run.id)).toContain('Fresh session (last turn did not finish)');
  });

  it('falls back to a fresh session with the note and the chat so far when the load fails', async () => {
    start();
    const turn = await interrupted();
    const [before] = await sessions(turn.conversationId);
    rmSync(join(store, `${before!.session_id}.json`));
    const sent = await proceed(turn.runId);
    worker.wake();
    expect((await untilFinished(t, sent.run.id)).status).toBe('succeeded');

    expect(await stepNames(t, sent.run.id)).toContain(freshAfterInterruption("couldn't resume"));
    const after = await sessions(turn.conversationId);
    expect(after).toHaveLength(2);
    expect(after[1]!.session_id).not.toBe(before!.session_id);
    const [first] = fakePrompts(store, after[1]!.session_id);
    expect(first).toContain('## Your previous turn was interrupted');
    expect(first).toContain(REQUEST);
    const { rows } = await t.db.query<{ decision: string }>(
      `SELECT payload->'params'->>'decision' AS decision FROM run_protocol_log
       WHERE run_id = $1 AND method = $2`,
      [sent.run.id, CONTINUED_SESSION_METHOD],
    );
    expect(rows).toEqual([{ decision: 'fresh session' }]);
  });

  it('leaves approvals from the interrupted run expired and tells the agent so', async () => {
    start(NEVER_SWEEP_MS);
    const turn = await midTurn();
    await insertCommandApproval(t, turn.runId, '/work/app', 'git push origin spark/herons');
    await expireLeases(t, turn.runId);
    await recoverExpiredLeases(t.db);
    await worker.idle();
    const sent = await proceed(turn.runId);
    worker.wake();
    await untilFinished(t, sent.run.id);

    const { rows } = await t.db.query<{ run_id: string; status: string; decided_by: string }>(
      `SELECT a.run_id, a.status, a.decided_by FROM approvals a JOIN runs r ON r.id = a.run_id
       WHERE r.conversation_id = $1`,
      [turn.conversationId],
    );
    expect(rows).toEqual([{ run_id: turn.runId, status: 'expired', decided_by: 'recovery' }]);
    const [session] = await sessions(turn.conversationId);
    expect(fakePrompts(store, session!.session_id)[1]).toContain(
      'It was waiting for approval of "git push origin spark/herons". That never ran and is not approved.',
    );
  });

  it('does not loop when the continued run is interrupted too', async () => {
    start();
    const turn = await interrupted();
    const [session] = await sessions(turn.conversationId);
    await rewriteRequest(turn.runId, 'Tell me a long story about herons #slow');
    const second = await proceed(turn.runId);
    worker.wake();
    await eventually(async () =>
      fakePrompts(store, session!.session_id).length > 1 ? true : null,
    );
    await expireLeases(t, second.run.id);
    await untilStatus(t, second.run.id, 'outcome_unknown');
    await worker.idle();
    await new Promise((resolve) => setTimeout(resolve, 300));

    const { rows } = await t.db.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM runs WHERE conversation_id = $1',
      [turn.conversationId],
    );
    expect(rows[0]!.count).toBe(2);
    expect(await findInterruption(t.db, turn.conversationId)).toMatchObject({
      runId: second.run.id,
    });
    expect((await proceed(turn.runId)).run.id).toBe(second.run.id);
    await rewriteRequest(turn.runId, REQUEST);
    const third = await proceed(second.run.id);
    expect(third.run.continuesRunId).toBe(second.run.id);
    worker.wake();
    expect((await untilFinished(t, third.run.id)).status).toBe('succeeded');
    expect(fakePrompts(store, session!.session_id).at(-1)).toContain(
      `Original request:\n${REQUEST}`,
    );
  });
});

describe('Start fresh after an interruption', { timeout: 90_000 }, () => {
  it('records the choice, closes the session and makes the next message start fresh', async () => {
    start();
    const turn = await interrupted();
    const run = await startFreshAfterInterruption(t.db, t.workspaceId, turn.runId);
    expect(run.interruptionChoice).toBe('fresh');
    await startFreshAfterInterruption(t.db, t.workspaceId, turn.runId);
    const audits = (await auditMethods(t, turn.runId)).filter(
      (method) => method === START_FRESH_METHOD,
    );
    expect(audits).toHaveLength(1);
    expect(await findInterruption(t.db, turn.conversationId)).toBeNull();
    const summary = (await getConversationDetail(t.db, turn.conversationId))?.conversation;
    expect(summary?.latestRun).toMatchObject({ id: turn.runId, interruptionChoice: 'fresh' });
    expect(await sessions(turn.conversationId)).toMatchObject([{ close_reason: 'started fresh' }]);
    await expect(proceed(turn.runId)).rejects.toMatchObject({ refusal: 'started_fresh' });

    await rewriteRequest(turn.runId, 'Tell me a long story about herons');
    const next = await sendUserMessage(
      t.db,
      turn.conversationId,
      { id: randomUUID(), content: 'Start over, a short one please' },
      TARGET,
    );
    worker.wake();
    await untilFinished(t, next.run.id);
    expect(await stepNames(t, next.run.id)).toContain('Fresh session (started fresh)');
  });

  it('is refused after Continue, and for a run that was never interrupted', async () => {
    start();
    const turn = await interrupted();
    const sent = await proceed(turn.runId);
    await expect(
      startFreshAfterInterruption(t.db, t.workspaceId, turn.runId),
    ).rejects.toMatchObject({ refusal: 'continued' });
    worker.wake();
    await untilFinished(t, sent.run.id);
    await expect(
      startFreshAfterInterruption(t.db, t.workspaceId, sent.run.id),
    ).rejects.toMatchObject({ refusal: 'not_interrupted' });
    await expect(proceed(sent.run.id)).rejects.toMatchObject({ refusal: 'not_interrupted' });
  });
});

describe('a crew run that was interrupted', { timeout: 90_000 }, () => {
  it('offers only Start fresh and says why', async () => {
    start();
    const turn = await interrupted();
    await t.db.query(
      `INSERT INTO runs (id, conversation_id, user_message_id, provider, status, parent_run_id,
         role, route)
       SELECT $2, conversation_id, user_message_id, provider, 'outcome_unknown', id, 'coordinator',
         '{}'::jsonb
       FROM runs WHERE id = $1`,
      [turn.runId, randomUUID()],
    );
    expect(await findInterruption(t.db, turn.conversationId)).toMatchObject({
      runId: turn.runId,
      blocked: 'crew',
    });
    const refused = await proceed(turn.runId).catch((error: unknown) => error);
    expect(refused).toMatchObject({ refusal: 'crew' });
    expect((refused as Error).message).toContain("can't resume a crew part-way yet");
    expect(await continuations(turn.runId)).toBe(0);
    const run = await startFreshAfterInterruption(t.db, t.workspaceId, turn.runId);
    expect(run.interruptionChoice).toBe('fresh');
  });

  it('waits while a child run is still being swept', async () => {
    start();
    const turn = await interrupted();
    const childId = randomUUID();
    await t.db.query(
      `INSERT INTO runs (id, conversation_id, user_message_id, provider, status, parent_run_id,
         role, route)
       SELECT $2, conversation_id, user_message_id, provider, 'running', id, 'builder', '{}'::jsonb
       FROM runs WHERE id = $1`,
      [turn.runId, childId],
    );
    expect(await findInterruption(t.db, turn.conversationId)).toBeNull();
    await expect(proceed(turn.runId)).rejects.toMatchObject({ refusal: 'settling' });
    await t.db.query(`UPDATE runs SET status = 'outcome_unknown' WHERE id = $1`, [childId]);
    expect(await findInterruption(t.db, turn.conversationId)).toMatchObject({ blocked: null });
  });
});
