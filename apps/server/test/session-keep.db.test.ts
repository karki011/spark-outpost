import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sendUserMessage } from '../src/persistence/conversations.ts';
import { STOPPED_NOTE } from '../src/workflow/session-decision.ts';
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

async function sessionSteps(runId: string): Promise<string[]> {
  const { rows } = await t.db.query<{ name: string }>(
    `SELECT payload->>'stepName' AS name FROM run_events e JOIN runs r ON r.id = e.run_id
     WHERE (r.id = $1 OR r.parent_run_id = $1) AND e.type = 'STEP_STARTED'
     ORDER BY e.created_at, e.seq`,
    [runId],
  );
  return rows.map((row) => row.name).filter((name) => /session/i.test(name));
}

interface BuilderSessionRow {
  session_id: string;
  agent_key: string;
  last_reply_hash: string | null;
  close_reason: string | null;
}

async function conversationSessions(conversationId: string): Promise<BuilderSessionRow[]> {
  const { rows } = await t.db.query<BuilderSessionRow>(
    `SELECT session_id, agent_key, last_reply_hash, close_reason FROM provider_sessions
     WHERE conversation_id = $1 AND starts_with(agent_key, 'chat:') ORDER BY created_at`,
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

describe('continuing after Stop', () => {
  it("resumes the chat's one conversation session after the last turn crashed, without the stopped note", async () => {
    const script: JevScript = { calls: [], scenario: TRIVIAL };
    harness = startOrchestrator(t, jevFetch(script), { sessions: store });
    const first = await startScenario(t, root, TRIVIAL, 'hands-off');
    await driveToEnd(t, first.conversationId, first.runId);
    await t.db.query(
      'UPDATE provider_sessions SET last_reply_hash = NULL WHERE conversation_id = $1',
      [first.conversationId],
    );
    const [crashed] = await conversationSessions(first.conversationId);
    expect(crashed).toMatchObject({ agent_key: 'chat:claude', last_reply_hash: null });

    script.scenario = { ...TRIVIAL, continuesTask: 0.95 };
    const second = await secondTurn(first.conversationId, 'continue #build');
    expect(second.orchestration.status).toBe('succeeded');
    expect(await sessionSteps(second.runId)).toEqual(['Continued session']);
    const rows = await conversationSessions(first.conversationId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      session_id: crashed!.session_id,
      agent_key: 'chat:claude',
      close_reason: null,
    });
    expect(rows[0]!.last_reply_hash).not.toBeNull();
    expect(fakePrompts(rows[0]!.session_id).join('\n')).not.toContain(STOPPED_NOTE);
  }, 60_000);
});

describe('deleting a chat mid-run', () => {
  it('stops the active run, then deletes the chat and its sessions', async () => {
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
    await remove().expect(204);
    const runs = await t.db.query('SELECT 1 FROM runs WHERE id = $1', [runId]);
    expect(runs.rows).toEqual([]);
    const left = await t.db.query('SELECT 1 FROM provider_sessions');
    expect(left.rows).toEqual([]);
  }, 60_000);
});
