import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sendUserMessage } from '../src/persistence/conversations.ts';
import { requestCancel } from '../src/persistence/runs.ts';
import { KEPT_FOR_SESSION } from '../src/orchestration/session-keep.ts';
import { STOPPED_NOTE, STOPPED_REPLY } from '../src/workflow/session-decision.ts';
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
import { createTestApp, ORIGIN, LOCAL_HEADERS } from './app-support.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

let t: TestDb;
let root: string;
let store: string;
let harness: Harness | null = null;

beforeEach(async () => {
  t = await createTestDb();
  root = await gitRepo();
  store = mkdtempSync(join(tmpdir(), 'fake-acp-store-'));
  await connectProviders(t);
});

afterEach(async () => {
  await harness?.stop();
  harness = null;
  await t.cleanup();
  await removeRepo(root);
  rmSync(store, { recursive: true, force: true });
});

async function secondTurn(conversationId: string, text: string) {
  const sent = await sendUserMessage(
    t.db,
    conversationId,
    { id: randomUUID(), content: text },
    { provider: 'claude', model: 'sonnet', effort: 'medium', permission: 'do', level: 'hands-off' },
  );
  harness!.worker.wake();
  return driveToEnd(t, conversationId, sent.run.id).then((done) => ({
    ...done,
    runId: sent.run.id,
  }));
}

async function builderRow(runId: string) {
  const { rows } = await t.db.query<{ model: string; effort: string; task_id: string }>(
    `SELECT model, effort, task_id FROM runs WHERE parent_run_id = $1 AND role = 'builder'
     ORDER BY created_at LIMIT 1`,
    [runId],
  );
  return rows[0]!;
}

async function sessionSteps(runId: string): Promise<string[]> {
  const { rows } = await t.db.query<{ name: string }>(
    `SELECT payload->>'stepName' AS name FROM run_events e JOIN runs r ON r.id = e.run_id
     WHERE (r.id = $1 OR r.parent_run_id = $1) AND e.type = 'STEP_STARTED'
     ORDER BY e.created_at, e.seq`,
    [runId],
  );
  return rows.map((row) => row.name).filter((name) => /session/i.test(name));
}

async function openSessionKeys(conversationId: string): Promise<string[]> {
  const { rows } = await t.db.query<{ agent_key: string }>(
    `SELECT agent_key FROM provider_sessions
     WHERE conversation_id = $1 AND closed_at IS NULL ORDER BY created_at`,
    [conversationId],
  );
  return rows.map((row) => row.agent_key);
}

describe('task-scoped Builder sessions', () => {
  it('resumes the task Builder for a follow-up, keeping its model, and leaves the chat session alone', async () => {
    const confident = { ...TRIVIAL, tier: 'top' as const };
    const script: JevScript = { calls: [], scenario: confident };
    harness = startOrchestrator(t, jevFetch(script), { sessions: store });
    const first = await startScenario(t, root, confident, 'hands-off');
    await driveToEnd(t, first.conversationId, first.runId);
    const firstBuilder = await builderRow(first.runId);
    expect(firstBuilder).toMatchObject({ model: 'opus[1m]', effort: 'medium' });
    expect(await openSessionKeys(first.conversationId)).toEqual([
      `key:${firstBuilder.task_id}:builder`,
    ]);

    script.scenario = { ...TRIVIAL, continuesTask: 0.95, tier: 'mid' };
    const second = await secondTurn(
      first.conversationId,
      'Also make the heading shorter and keep the tone. #build',
    );
    expect(second.orchestration.status).toBe('succeeded');
    const secondBuilder = await builderRow(second.runId);
    expect(secondBuilder).toMatchObject({ model: 'opus[1m]', task_id: firstBuilder.task_id });
    expect(await sessionSteps(second.runId)).toContain('Continued session');
    const route = second.orchestration.decisions.find((decision) => decision.kind === 'route');
    expect(route?.answer.rule).toBe(KEPT_FOR_SESSION);
    expect(route?.answer.session).toMatchObject({ kept: true, session: { model: 'opus[1m]' } });
    const intake = second.orchestration.decisions.find((decision) => decision.kind === 'intake');
    expect(intake?.summary).toContain('same task (jev 0.95)');
  }, 60_000);

  it('starts a fresh task and closes the old task’s session when the message is new work', async () => {
    const script: JevScript = { calls: [], scenario: TRIVIAL };
    harness = startOrchestrator(t, jevFetch(script), { sessions: store });
    const first = await startScenario(t, root, TRIVIAL, 'hands-off');
    await driveToEnd(t, first.conversationId, first.runId);
    const oldTask = (await builderRow(first.runId)).task_id;

    script.scenario = { ...TRIVIAL, continuesTask: 0.03 };
    const second = await secondTurn(first.conversationId, 'Now add a logout button. #build');
    const newTask = (await builderRow(second.runId)).task_id;
    expect(newTask).not.toBe(oldTask);
    expect(await sessionSteps(second.runId)).not.toContain('Continued session');
    const { rows } = await t.db.query<{ agent_key: string; close_reason: string | null }>(
      `SELECT agent_key, close_reason FROM provider_sessions WHERE conversation_id = $1
       ORDER BY created_at`,
      [first.conversationId],
    );
    expect(rows).toEqual([
      { agent_key: `key:${oldTask}:builder`, close_reason: 'a new task started' },
      { agent_key: `key:${newTask}:builder`, close_reason: null },
    ]);
    const { rows: tasks } = await t.db.query<{ status: string }>(
      'SELECT status FROM tasks WHERE id = $1',
      [oldTask],
    );
    expect(tasks[0]!.status).toBe('closed');
  }, 60_000);
});

interface BuilderSessionRow {
  session_id: string;
  agent_key: string;
  last_reply_hash: string | null;
  close_reason: string | null;
}

async function builderSessions(conversationId: string): Promise<BuilderSessionRow[]> {
  const { rows } = await t.db.query<BuilderSessionRow>(
    `SELECT session_id, agent_key, last_reply_hash, close_reason FROM provider_sessions
     WHERE conversation_id = $1 AND starts_with(agent_key, 'key:') ORDER BY created_at`,
    [conversationId],
  );
  return rows;
}

function fakePrompts(sessionId: string): string[] {
  const stored = JSON.parse(readFileSync(join(store, `${sessionId}.json`), 'utf8')) as {
    prompts: string[];
  };
  return stored.prompts;
}

async function stopMidBuild(script: JevScript) {
  harness = startOrchestrator(t, jevFetch(script), { sessions: store });
  const slow = withTag(TRIVIAL, '#slowbuild');
  const first = await startScenario(t, root, slow, 'hands-off');
  await eventually(async () => {
    const rows = await builderSessions(first.conversationId);
    const notes = await readFile(join(root, 'notes.txt'), 'utf8').catch(() => '');
    return rows.length > 0 && notes.includes('step 1') ? true : null;
  }, 30_000);
  await requestCancel(t.db, first.runId);
  const { orchestration } = await driveToEnd(t, first.conversationId, first.runId);
  expect(orchestration.status).toBe('cancelled');
  return first;
}

describe('continuing after Stop', () => {
  it('resumes the stopped Builder session with a stop note and the files it had changed', async () => {
    const script: JevScript = { calls: [], scenario: TRIVIAL };
    const first = await stopMidBuild(script);
    const [stopped] = await builderSessions(first.conversationId);
    expect(stopped).toMatchObject({ last_reply_hash: STOPPED_REPLY, close_reason: null });
    const firstTask = (await builderRow(first.runId)).task_id;

    script.scenario = { ...TRIVIAL, continuesTask: 0.95 };
    const second = await secondTurn(first.conversationId, 'continue #build');
    expect(second.orchestration.status).toBe('succeeded');
    expect((await builderRow(second.runId)).task_id).toBe(firstTask);
    expect(await sessionSteps(second.runId)).toContain('Continued session');
    const rows = await builderSessions(first.conversationId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      session_id: stopped!.session_id,
      agent_key: stopped!.agent_key,
      close_reason: null,
    });
    expect(rows[0]!.last_reply_hash).not.toBe(STOPPED_REPLY);
    const prompts = fakePrompts(stopped!.session_id);
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain(STOPPED_NOTE);
    expect(prompts[1]).toContain('`notes.txt`');
    expect(prompts[1]).toContain('continue #build');
    const notes = await readFile(join(root, 'notes.txt'), 'utf8');
    expect(notes).toContain('step 1');
  }, 60_000);

  it('starts a fresh Builder session when the last turn crashed instead', async () => {
    const script: JevScript = { calls: [], scenario: TRIVIAL };
    harness = startOrchestrator(t, jevFetch(script), { sessions: store });
    const first = await startScenario(t, root, TRIVIAL, 'hands-off');
    await driveToEnd(t, first.conversationId, first.runId);
    await t.db.query(
      'UPDATE provider_sessions SET last_reply_hash = NULL WHERE conversation_id = $1',
      [first.conversationId],
    );
    const [crashed] = await builderSessions(first.conversationId);

    script.scenario = { ...TRIVIAL, continuesTask: 0.95 };
    const second = await secondTurn(first.conversationId, 'continue #build');
    expect(second.orchestration.status).toBe('succeeded');
    expect(await sessionSteps(second.runId)).not.toContain('Continued session');
    const rows = await builderSessions(first.conversationId);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      session_id: crashed!.session_id,
      close_reason: 'last turn did not finish',
    });
    expect(rows[1]!.session_id).not.toBe(crashed!.session_id);
    expect(rows[1]!.close_reason).toBeNull();
    expect(fakePrompts(rows[1]!.session_id).join('\n')).not.toContain(STOPPED_NOTE);
  }, 60_000);
});

describe('deleting a chat mid-run', () => {
  it('refuses while the run is active, then deletes the chat and its sessions once it stopped', async () => {
    const script: JevScript = { calls: [], scenario: TRIVIAL };
    harness = startOrchestrator(t, jevFetch(script), { sessions: store });
    const slow = withTag(TRIVIAL, '#slowbuild');
    const { conversationId, runId } = await startScenario(t, root, slow, 'hands-off');
    await eventually(async () => {
      const { rows } = await t.db.query(
        'SELECT 1 FROM provider_sessions WHERE conversation_id = $1',
        [conversationId],
      );
      return rows.length > 0 ? true : null;
    }, 30_000);
    const app = createTestApp(t);
    const remove = () =>
      request(app)
        .delete(`/api/conversations/${conversationId}`)
        .set(LOCAL_HEADERS)
        .set('Origin', ORIGIN)
        .send({});
    const busy = await remove().expect(409);
    expect(busy.body.error).toMatch(/Stop the reply/);

    await requestCancel(t.db, runId);
    const { orchestration } = await driveToEnd(t, conversationId, runId);
    expect(orchestration.status).toBe('cancelled');
    await remove().expect(204);
    const left = await t.db.query('SELECT 1 FROM provider_sessions');
    expect(left.rows).toEqual([]);
  }, 60_000);
});
