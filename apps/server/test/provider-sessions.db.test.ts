import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createConversation } from '../src/persistence/conversations.ts';
import { evictBeyondLimit, latestProviderSession } from '../src/persistence/provider-sessions.ts';
import { createProject } from '../src/projects/projects.ts';
import type { RunInput } from '../src/workflow/run-input.ts';
import { SESSION_WORKDIR_ROOT } from '../src/workflow/session-decision.ts';
import { prepareTurnSession, sweepSessions } from '../src/workflow/turn-session.ts';
import { createTestApp, ORIGIN, LOCAL_HEADERS } from './app-support.ts';
import {
  chatTurnInput,
  connectCliProvider,
  createTestDb,
  SESSION_LIMITS,
  type TestDb,
  underCurrent,
} from './support.ts';

let t: TestDb;
let app: ReturnType<typeof createTestApp>;

beforeEach(async () => {
  t = await createTestDb();
  app = createTestApp(t, { fixedRunProvider: null });
});

afterEach(async () => {
  await t.cleanup();
});

const send = (method: 'patch' | 'post' | 'delete', path: string, body?: object) => {
  const call = request(app)[method](path).set(LOCAL_HEADERS).set('Origin', ORIGIN);
  return body ? call.send(body) : call;
};

async function conversation(): Promise<string> {
  return (await createConversation(t.db, t.workspaceId, randomUUID())).id;
}

async function message(conversationId: string, role: 'user' | 'assistant', content: string) {
  const id = randomUUID();
  await t.db.query(
    `INSERT INTO messages (id, conversation_id, role, content, created_at)
     VALUES ($1, $2, $3, $4, clock_timestamp())`,
    [id, conversationId, role, content],
  );
  return id;
}

const usage = (costUsd: number | null) =>
  ({ kind: 'usage', contextUsed: 10, contextSize: 100, costUsd }) as const;

async function completeTurn(input: RunInput, sessionId: string, reply: string, cost = 0.015) {
  const turn = await prepareTurnSession(t.db, input, SESSION_LIMITS);
  if (!turn) throw new Error('The turn was not tracked.');
  await turn.started({
    kind: 'session',
    sessionId,
    cwd: turn.target.workdir ?? '/work',
    additionalDirectories: [],
    continued: turn.target.resume?.sessionId === sessionId,
    freshReason: turn.target.freshReason,
  });
  const recorded = turn.usage(usage(cost));
  const messageId = await message(input.identity.threadId, 'assistant', reply);
  await turn.finished({ outcome: 'succeeded', messageId, text: reply });
  return { turn, messageId, recorded };
}

describe('provider sessions across chat turns', () => {
  it.runIf(underCurrent)(
    'resumes the next turn and starts fresh once the chat moves on',
    async () => {
      const id = await conversation();
      await message(id, 'user', 'hi');
      const first = await completeTurn(chatTurnInput(t, id, null), 's-1', 'Hello.');
      expect(first.turn.target).toMatchObject({ resume: null, freshReason: null });
      expect(first.turn.target.workdir?.startsWith(SESSION_WORKDIR_ROOT)).toBe(true);

      await message(id, 'user', 'again');
      const second = await prepareTurnSession(
        t.db,
        chatTurnInput(t, id, first.messageId),
        SESSION_LIMITS,
      );
      expect(second?.target.resume).toEqual({
        sessionId: 's-1',
        cwd: first.turn.target.workdir,
        additionalDirectories: [],
      });

      await message(id, 'user', 'a queued message');
      const moved = await prepareTurnSession(
        t.db,
        chatTurnInput(t, id, randomUUID()),
        SESSION_LIMITS,
      );
      expect(moved?.target).toMatchObject({ resume: null, freshReason: 'chat changed since' });
    },
  );

  it('records only the new cost when the agent reports a cumulative session cost', async () => {
    const id = await conversation();
    const first = await completeTurn(chatTurnInput(t, id, null), 's-1', 'Hello.', 0.015);
    expect(first.recorded.costUsd).toBe(0.015);
    const second = await completeTurn(
      chatTurnInput(t, id, first.messageId),
      's-1',
      'Again.',
      0.0164,
    );
    expect(second.turn.target.resume?.sessionId).toBe('s-1');
    expect(second.recorded.costUsd).toBeCloseTo(0.0014, 6);
    expect(second.turn.usage(usage(null)).costUsd).toBeNull();
    const fresh = await completeTurn(chatTurnInput(t, id, randomUUID()), 's-2', 'New.', 0.02);
    expect(fresh.recorded.costUsd).toBe(0.02);
  });

  it.runIf(underCurrent)(
    'starts fresh after a changed model and keeps one open session per key',
    async () => {
      const id = await conversation();
      const first = await completeTurn(chatTurnInput(t, id, null), 's-1', 'Hello.');
      const input = chatTurnInput(t, id, first.messageId);
      const changed = { ...input, settings: { ...input.settings, model: 'opus' } };
      const turn = await prepareTurnSession(t.db, changed, SESSION_LIMITS);
      expect(turn?.target).toMatchObject({ resume: null, freshReason: 'settings changed' });
      await turn?.started({
        kind: 'session',
        sessionId: 's-2',
        cwd: '/work',
        additionalDirectories: [],
        continued: false,
        freshReason: 'settings changed',
      });
      const { rows } = await t.db.query<{ session_id: string; close_reason: string | null }>(
        'SELECT session_id, close_reason FROM provider_sessions ORDER BY created_at',
      );
      expect(rows).toEqual([
        { session_id: 's-1', close_reason: 'settings changed' },
        { session_id: 's-2', close_reason: null },
      ]);
    },
  );

  it.runIf(underCurrent)('closes the session when the turn fails', async () => {
    const id = await conversation();
    const turn = await prepareTurnSession(t.db, chatTurnInput(t, id, null), SESSION_LIMITS);
    await turn?.started({
      kind: 'session',
      sessionId: 's-1',
      cwd: '/work',
      additionalDirectories: [],
      continued: false,
      freshReason: null,
    });
    await turn?.finished({ outcome: 'failed', messageId: null, text: '' });
    const next = await prepareTurnSession(t.db, chatTurnInput(t, id, null), SESSION_LIMITS);
    expect(next?.target).toMatchObject({ resume: null, freshReason: 'last turn did not finish' });
  });

  it('saves no session when the chat was deleted while the turn ran', async () => {
    const id = await conversation();
    const turn = await prepareTurnSession(t.db, chatTurnInput(t, id, null), SESSION_LIMITS);
    await t.db.query('DELETE FROM conversations WHERE id = $1', [id]);
    await turn?.started({
      kind: 'session',
      sessionId: 's-1',
      cwd: '/work',
      additionalDirectories: [],
      continued: false,
      freshReason: null,
    });
    await turn?.finished({ outcome: 'succeeded', messageId: null, text: 'Done.' });
    const { rows } = await t.db.query('SELECT 1 FROM provider_sessions');
    expect(rows).toEqual([]);
  });

  it('tracks orchestration children only when they carry a resume key', async () => {
    const id = await conversation();
    const child = { ...chatTurnInput(t, id, null), parentRunId: randomUUID(), mode: 'do' as const };
    expect(await prepareTurnSession(t.db, child, SESSION_LIMITS)).toBeNull();
    const keyed = { ...child, resumeKey: 'task-1:builder:Bolt', followUp: 'Fix the findings.' };
    const first = await completeTurn(keyed, 'b-1', 'Done.');
    expect(first.turn.target.followUp).toBe('Fix the findings.');
    const again = await prepareTurnSession(t.db, keyed, SESSION_LIMITS);
    expect(again?.target.resume?.sessionId).toBe('b-1');
    const stored = await latestProviderSession(t.db, id, 'key:task-1:builder:Bolt');
    expect(stored?.lastMessageId).toBeNull();
  });
});

describe('provider session lifecycle', () => {
  async function openSession(conversationId: string, sessionId: string, minutesAgo = 0) {
    await t.db.query(
      `INSERT INTO provider_sessions
         (id, conversation_id, provider, agent_key, session_id, cwd, settings_hash,
          last_reply_hash, last_used_at)
       VALUES ($1, $2, 'claude', $3, $3, '/work', 'h', 'r',
               now() - make_interval(mins => $4))`,
      [randomUUID(), conversationId, sessionId, minutesAgo],
    );
  }

  const openIds = async () =>
    (
      await t.db.query<{ session_id: string }>(
        'SELECT session_id FROM provider_sessions WHERE closed_at IS NULL ORDER BY session_id',
      )
    ).rows.map((row) => row.session_id);

  it('evicts the least recently used sessions beyond the limit', async () => {
    const id = await conversation();
    for (let index = 0; index < 10; index++) await openSession(id, `s-${index}`, index + 1);
    expect(await evictBeyondLimit(t.db, 8)).toBe(2);
    expect(await openIds()).not.toContain('s-9');
    expect(await openIds()).not.toContain('s-8');
    const reasons = await t.db.query<{ close_reason: string }>(
      'SELECT DISTINCT close_reason FROM provider_sessions WHERE closed_at IS NOT NULL',
    );
    expect(reasons.rows).toEqual([{ close_reason: 'too many open sessions' }]);
  });

  it('closes idle and archived sessions and removes idle session folders', async () => {
    const busy = await conversation();
    const archived = await conversation();
    await openSession(busy, 'recent', 1);
    await openSession(busy, 'idle', 45);
    await openSession(archived, 'archived', 1);
    await t.db.query('UPDATE conversations SET archived_at = now() WHERE id = $1', [archived]);
    mkdirSync(SESSION_WORKDIR_ROOT, { recursive: true });
    const folder = mkdtempSync(join(SESSION_WORKDIR_ROOT, 'test-'));
    await t.db.query(`UPDATE provider_sessions SET workdir = $1 WHERE session_id = 'idle'`, [
      folder,
    ]);
    expect(await sweepSessions(t.db, SESSION_LIMITS)).toBe(2);
    expect(await openIds()).toEqual(['recent']);
    expect(existsSync(folder)).toBe(false);
    const { rows } = await t.db.query(
      'SELECT workdir FROM provider_sessions WHERE workdir IS NOT NULL',
    );
    expect(rows).toEqual([]);
  });

  it('never removes folders outside the session root', async () => {
    const id = await conversation();
    await openSession(id, 'old', 90);
    const outside = mkdtempSync(join(tmpdir(), 'not-a-session-'));
    await t.db.query(`UPDATE provider_sessions SET workdir = $1`, [outside]);
    await sweepSessions(t.db, SESSION_LIMITS);
    expect(existsSync(outside)).toBe(true);
    rmSync(outside, { recursive: true, force: true });
  });
});

describe('closing sessions from the chat', () => {
  it('closes on changed settings or repos, Start fresh and archive, but not on a no-op', async () => {
    await connectCliProvider(t, 'claude');
    const id = await conversation();
    const reopen = async (sessionId: string) =>
      t.db.query(
        `INSERT INTO provider_sessions
           (id, conversation_id, provider, agent_key, session_id, cwd, settings_hash)
         VALUES ($1, $2, 'claude', 'chat:chat', $3, '/work', 'h')`,
        [randomUUID(), id, sessionId],
      );
    const reason = async (sessionId: string) =>
      (
        await t.db.query<{ close_reason: string | null }>(
          'SELECT close_reason FROM provider_sessions WHERE session_id = $1',
          [sessionId],
        )
      ).rows[0]?.close_reason;

    await send('patch', `/api/conversations/${id}/settings`, { effort: 'high' }).expect(200);
    await reopen('a');
    await send('patch', `/api/conversations/${id}/settings`, { effort: 'high' }).expect(200);
    expect(await reason('a')).toBeNull();
    await send('patch', `/api/conversations/${id}/settings`, { effort: 'low' }).expect(200);
    expect(await reason('a')).toBe('settings changed');

    await reopen('b');
    const repo = mkdtempSync(join(tmpdir(), 'session-repo-'));
    const { project } = await createProject(t.db, t.workspaceId, repo);
    await send('patch', `/api/conversations/${id}/settings`, { projectIds: [project.id] }).expect(
      200,
    );
    expect(await reason('b')).toBe('repos changed');

    await reopen('c');
    const fresh = await send('post', `/api/conversations/${id}/fresh-session`, {}).expect(200);
    expect(fresh.body).toEqual({ closed: 1 });
    expect(await reason('c')).toBe('started fresh');

    await reopen('d');
    await send('patch', `/api/conversations/${id}`, { archived: true }).expect(200);
    expect(await reason('d')).toBe('chat archived');

    await send('delete', `/api/conversations/${id}`, {}).expect(204);
    const left = await t.db.query('SELECT 1 FROM provider_sessions');
    expect(left.rows).toEqual([]);
    rmSync(repo, { recursive: true, force: true });
  });
});
