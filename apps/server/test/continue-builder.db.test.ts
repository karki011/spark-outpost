import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { REOPENED_INTERRUPTED } from '../src/agents/acp/session-open.ts';
import { getConversationDetail } from '../src/persistence/conversations.ts';
import { resolveRunTarget } from '../src/api/run-target.ts';
import { getRun } from '../src/persistence/runs.ts';
import { recoverExpiredLeases } from '../src/workflow/recovery.ts';
import { createTestApp, localClient } from './app-support.ts';
import {
  expireLeases,
  fakePrompts,
  resumedSessionIds,
  stepNames,
  untilStatus,
} from './interruption-support.ts';
import {
  TRIVIAL,
  connectProviders,
  driveToEnd,
  gitRepo,
  jevFetch,
  removeRepo,
  startOrchestrator,
  startScenario,
  withTag,
  type Harness,
  type JevScript,
} from './orchestration-support.ts';
import { createTestDb, eventually, type TestDb, BUILDER_SESSION_KEYS } from './support.ts';

const STALLING = withTag(TRIVIAL, '#stallbuild');

let t: TestDb;
let root: string;
let store: string;
let harness: Harness;

beforeEach(async () => {
  t = await createTestDb();
  root = await gitRepo();
  store = mkdtempSync(join(tmpdir(), 'fake-acp-store-'));
  await connectProviders(t);
  const script: JevScript = { calls: [], scenario: TRIVIAL };
  harness = startOrchestrator(t, jevFetch(script), { sessions: store });
});

afterEach(async () => {
  await harness.stop();
  await t.cleanup();
  await removeRepo(root);
  rmSync(store, { recursive: true, force: true });
});

interface BuilderRun {
  id: string;
  status: string;
  model: string;
  task_id: string;
}

async function builders(runId: string): Promise<BuilderRun[]> {
  const { rows } = await t.db.query<BuilderRun>(
    `SELECT id, status, model, task_id FROM runs
     WHERE parent_run_id = $1 AND role = 'builder' ORDER BY created_at`,
    [runId],
  );
  return rows;
}

async function builderSessions(conversationId: string) {
  const { rows } = await t.db.query<{ session_id: string; last_reply_hash: string | null }>(
    `SELECT session_id, last_reply_hash FROM provider_sessions
     WHERE conversation_id = $1 AND agent_key LIKE $2 ORDER BY created_at`,
    [conversationId, BUILDER_SESSION_KEYS],
  );
  return rows;
}

async function interruptedBuild() {
  const first = await startScenario(t, root, STALLING, 'hands-off');
  await eventually(async () => {
    const rows = await builderSessions(first.conversationId);
    const notes = await readFile(join(root, 'notes.txt'), 'utf8').catch(() => '');
    return rows.length > 0 && notes.includes('step 1') ? true : null;
  }, 30_000);
  await expireLeases(t, first.runId);
  await recoverExpiredLeases(t.db);
  await untilStatus(t, first.runId, 'outcome_unknown');
  await harness.worker.idle();
  return first;
}

describe('Continue from here for an interrupted Builder', { timeout: 120_000 }, () => {
  it('reopens the Builder session through the API with the note and the changed files', async () => {
    const first = await interruptedBuild();
    const [stalled] = await builders(first.runId);
    expect(stalled!.status).toBe('outcome_unknown');
    const [session] = await builderSessions(first.conversationId);
    expect(session!.last_reply_hash).toBeNull();
    const detail = await getConversationDetail(t.db, first.conversationId);
    expect(detail?.interruption).toMatchObject({ runId: first.runId, blocked: null });

    const client = localClient(createTestApp(t, { fixedRunProvider: null }));
    const messageId = randomUUID();
    const clicked = await client.send('post', `/api/runs/${first.runId}/continue`, {
      id: messageId,
    });
    expect(clicked.status).toBe(201);
    const again = await client.send('post', `/api/runs/${first.runId}/continue`, {
      id: randomUUID(),
    });
    expect(again.body.run.id).toBe(clicked.body.run.id);
    const fresh = await client.send('post', `/api/runs/${first.runId}/start-fresh`);
    expect(fresh.status).toBe(409);
    expect(fresh.body.error).toBe('This turn was already continued.');
    const continuedId = clicked.body.run.id as string;
    harness.worker.wake();
    const { orchestration } = await driveToEnd(t, first.conversationId, continuedId);
    expect(orchestration.status).toBe('succeeded');

    const [resumed] = await builders(continuedId);
    expect(resumed).toMatchObject({ task_id: stalled!.task_id, model: stalled!.model });
    expect(await resumedSessionIds(t, continuedId)).toEqual([session!.session_id]);
    expect(await stepNames(t, continuedId)).toContain(REOPENED_INTERRUPTED);
    const latest = (await builderSessions(first.conversationId)).at(-1);
    expect(latest?.session_id).toBe(session!.session_id);
    expect(latest?.last_reply_hash).not.toBeNull();
    const prompts = fakePrompts(store, session!.session_id);
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain('## Your previous turn was interrupted');
    expect(prompts[1]).toContain(`Original request:\n${STALLING.text}`);
    expect(prompts[1]).toContain('Files changed so far: `notes.txt`.');
    const intake = orchestration.decisions.find((decision) => decision.kind === 'intake');
    expect(intake?.summary).toContain('same task');
  });

  it('runs under the same mode and autonomy as the interrupted run', async () => {
    const first = await interruptedBuild();
    const client = localClient(createTestApp(t, { fixedRunProvider: null }));
    const clicked = await client.send('post', `/api/runs/${first.runId}/continue`, {
      id: randomUUID(),
    });
    const continuedId = clicked.body.run.id as string;
    harness.worker.wake();
    await driveToEnd(t, first.conversationId, continuedId);
    const before = await getRun(t.db, first.runId);
    const after = await getRun(t.db, continuedId);
    expect(after).toMatchObject({ mode: 'do', level: before!.level, provider: before!.provider });
    const target = await resolveRunTarget(
      { db: t.db, workspaceId: t.workspaceId },
      first.conversationId,
    );
    const { rows } = await t.db.query<{ agent_mode: string | null }>(
      'SELECT agent_mode FROM runs WHERE id = $1',
      [continuedId],
    );
    expect(rows[0]!.agent_mode).toBe(target.agentMode);
  });

  it('answers 404 for an unknown run and 409 with the reason for a finished one', async () => {
    const done = await startScenario(t, root, TRIVIAL, 'hands-off');
    await driveToEnd(t, done.conversationId, done.runId);
    const client = localClient(createTestApp(t, { fixedRunProvider: null }));
    const missing = await client.send('post', `/api/runs/${randomUUID()}/continue`, {
      id: randomUUID(),
    });
    expect(missing.status).toBe(404);
    const refused = await client.send('post', `/api/runs/${done.runId}/continue`, {
      id: randomUUID(),
    });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toContain("wasn't interrupted");
    const invalid = await client.send('post', `/api/runs/${done.runId}/continue`, { id: 'nope' });
    expect(invalid.status).toBe(400);
  });
});
