import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationSummary } from '@spark-outpost/contracts';
import { sendUserMessage } from '../src/persistence/conversations.ts';
import { archiveIfInactive, inactiveChats } from '../src/persistence/inactive-chats.ts';
import { archiveInactive, startArchiveSweep } from '../src/workflow/archive-inactive.ts';
import { createTestApp, localClient } from './app-support.ts';
import { createTestDb, eventually, startChat, type TestDb } from './support.ts';

let t: TestDb;
let app: ReturnType<typeof createTestApp>;

beforeEach(async () => {
  t = await createTestDb();
  app = createTestApp(t);
});

afterEach(async () => {
  vi.useRealTimers();
  await t.cleanup();
});

async function idleChat(days: number, content = 'Old work'): Promise<string> {
  const { conversationId, runId } = await startChat(t, content);
  await t.db.query(`DELETE FROM jobs WHERE run_id = $1`, [runId]);
  await t.db.query(`UPDATE runs SET status = 'succeeded' WHERE id = $1`, [runId]);
  await backdate(conversationId, days);
  return conversationId;
}

async function backdate(conversationId: string, days: number): Promise<void> {
  const ago = `now() - make_interval(days => ${days})`;
  await t.db.query(`UPDATE conversations SET created_at = ${ago} WHERE id = $1`, [conversationId]);
  await t.db.query(`UPDATE messages SET created_at = ${ago} WHERE conversation_id = $1`, [
    conversationId,
  ]);
  await t.db.query(
    `UPDATE runs SET created_at = ${ago}, started_at = ${ago}, finished_at = ${ago}
     WHERE conversation_id = $1`,
    [conversationId],
  );
}

async function runOf(conversationId: string): Promise<string> {
  const { rows } = await t.db.query<{ id: string }>(
    'SELECT id FROM runs WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 1',
    [conversationId],
  );
  return rows[0]!.id;
}

async function summary(id: string): Promise<ConversationSummary> {
  const listed = (await localClient(app).get('/api/conversations').expect(200))
    .body as ConversationSummary[];
  return listed.find((chat) => chat.id === id)!;
}

async function setDays(days: 2 | 7 | 30 | null): Promise<void> {
  await localClient(app).send('patch', '/api/profile', { archiveInactiveDays: days }).expect(200);
}

async function addCard(runId: string, status: 'pending' | 'allowed', decidedAgo = 0) {
  await t.db.query(
    `INSERT INTO approvals (id, run_id, tool_call_id, kind, title, payload, payload_hash, options,
       status, decided_at)
     VALUES ($1, $2, $3, 'execute', 'Run tests', '{}', 'sha256:x', '[]', $4,
       CASE WHEN $4 = 'pending' THEN NULL ELSE now() - make_interval(hours => $5) END)`,
    [randomUUID(), runId, `call-${randomUUID()}`, status, decidedAgo],
  );
}

async function outpostWith(member: string, request: 'open' | 'answered'): Promise<void> {
  const outpostId = randomUUID();
  await t.db.query(`INSERT INTO outposts (id, workspace_id, name) VALUES ($1, $2, 'Launch')`, [
    outpostId,
    t.workspaceId,
  ]);
  await t.db.query(
    `INSERT INTO outpost_members (outpost_id, conversation_id, handle, position)
     VALUES ($1, $2, 'docs', 1)`,
    [outpostId, member],
  );
  const runId = request === 'answered' ? await runOf(member) : null;
  await t.db.query(
    `INSERT INTO outpost_posts (id, outpost_id, kind, body, from_user, to_handle,
       to_conversation_id, run_id)
     VALUES ($1, $2, 'request', 'Write the docs', true, 'docs', $3, $4)`,
    [randomUUID(), outpostId, member, runId],
  );
}

describe('archiving inactive chats', () => {
  it('archives a chat idle past the setting, with the line and the session closed', async () => {
    const id = await idleChat(3);
    const sessionId = randomUUID();
    await t.db.query(
      `INSERT INTO provider_sessions
         (id, conversation_id, provider, agent_key, session_id, cwd, settings_hash)
       VALUES ($1, $2, 'claude', 'chat:chat', $3, '/work', 'h')`,
      [randomUUID(), id, sessionId],
    );

    expect(await archiveInactive(t.db, t.workspaceId)).toEqual([id]);

    expect(await summary(id)).toMatchObject({
      archivedAt: expect.any(String),
      autoArchivedDays: 2,
    });
    const { rows } = await t.db.query<{ close_reason: string }>(
      'SELECT close_reason FROM provider_sessions WHERE session_id = $1',
      [sessionId],
    );
    expect(rows[0]!.close_reason).toBe('Archived after 2 days without activity');
  });

  it('leaves chats with activity inside the window', async () => {
    const recent = await idleChat(1);
    const answered = await idleChat(5);
    await addCard(await runOf(answered), 'allowed', 3);
    const restored = await idleChat(5);
    await t.db.query('UPDATE conversations SET restored_at = now() WHERE id = $1', [restored]);

    expect(await archiveInactive(t.db, t.workspaceId)).toEqual([]);
    for (const id of [recent, answered, restored])
      expect((await summary(id)).archivedAt).toBeNull();
  });

  it('never archives a busy, waiting, pinned, Terminal, Ask Spark or outpost chat', async () => {
    const running = await idleChat(9, 'Running');
    await t.db.query(`UPDATE runs SET status = 'running' WHERE conversation_id = $1`, [running]);
    const queuedTurn = await idleChat(9, 'Queued turn');
    await t.db.query(`UPDATE runs SET status = 'queued' WHERE conversation_id = $1`, [queuedTurn]);
    const queuedMessage = await idleChat(9, 'Queued message');
    await t.db.query(
      `INSERT INTO chat_queue (id, conversation_id, position, content) VALUES ($1, $2, 1, 'next')`,
      [randomUUID(), queuedMessage],
    );
    const waiting = await idleChat(9, 'Waiting card');
    await addCard(await runOf(waiting), 'pending');
    const pinned = await idleChat(9, 'Pinned');
    await t.db.query('UPDATE conversations SET pinned_at = now() WHERE id = $1', [pinned]);
    const terminal = await idleChat(9, 'Terminal');
    await t.db.query(
      `INSERT INTO native_terminal_sessions (id, conversation_id, provider, state, cwd, label,
         updated_at)
       VALUES ($1, $2, 'claude', 'ready', '/work', 'Claude', now() - interval '9 days')`,
      [randomUUID(), terminal],
    );
    const assistant = await idleChat(9, 'Ask Spark');
    await t.db.query(
      `INSERT INTO profiles (workspace_id, assistant_conversation_id) VALUES ($1, $2)
       ON CONFLICT (workspace_id) DO UPDATE SET assistant_conversation_id = $2`,
      [t.workspaceId, assistant],
    );
    const member = await idleChat(9, 'Outpost member');
    await outpostWith(member, 'open');
    const answeredMember = await idleChat(9, 'Answered member');
    await outpostWith(answeredMember, 'answered');

    expect(await archiveInactive(t.db, t.workspaceId)).toEqual([answeredMember]);
  });

  it('leaves an unsent draft alone', async () => {
    const draft = randomUUID();
    await t.db.query(
      `INSERT INTO conversations (id, workspace_id, title, created_at)
       VALUES ($1, $2, 'New chat', now() - interval '9 days')`,
      [draft, t.workspaceId],
    );
    expect(await archiveInactive(t.db, t.workspaceId)).toEqual([]);
  });

  it('follows the setting, and Never archives nothing', async () => {
    const week = await idleChat(8);
    const fewDays = await idleChat(3);
    await setDays(7);
    expect(await archiveInactive(t.db, t.workspaceId)).toEqual([week]);
    expect((await summary(week)).autoArchivedDays).toBe(7);

    await setDays(null);
    expect((await localClient(app).get('/api/setup').expect(200)).body.profile).toMatchObject({
      archiveInactiveDays: null,
    });
    expect(await archiveInactive(t.db, t.workspaceId)).toEqual([]);
    expect((await summary(fewDays)).archivedAt).toBeNull();
  });

  it('archives once: a second sweep changes nothing', async () => {
    const id = await idleChat(4);
    await archiveInactive(t.db, t.workspaceId);
    const first = (await summary(id)).archivedAt;
    expect(await archiveInactive(t.db, t.workspaceId)).toEqual([]);
    expect((await summary(id)).archivedAt).toBe(first);
  });

  it('keeps a chat restored from History active and drops its line', async () => {
    const id = await idleChat(4);
    await archiveInactive(t.db, t.workspaceId);
    const restored = await localClient(app)
      .send('patch', `/api/conversations/${id}`, { archived: false })
      .expect(200);
    expect(restored.body.archivedAt).toBeNull();
    expect(restored.body.autoArchivedDays).toBeUndefined();
    expect(await archiveInactive(t.db, t.workspaceId)).toEqual([]);
  });

  it('lets a message sent during the sweep win', async () => {
    const id = await idleChat(4);
    expect(await inactiveChats(t.db, t.workspaceId, 2)).toEqual([id]);
    await sendUserMessage(
      t.db,
      id,
      { id: randomUUID(), content: 'Back again' },
      {
        provider: 'fake',
      },
    );
    expect(await archiveIfInactive(t.db, t.workspaceId, id, 2)).toBe(false);
    expect((await summary(id)).archivedAt).toBeNull();
  });

  it('archives at startup without waiting for the hourly timer', async () => {
    const id = await idleChat(4);
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval'] });
    const sweep = startArchiveSweep(t.db, t.workspaceId);
    vi.advanceTimersByTime(5_000);
    vi.useRealTimers();
    try {
      await eventually(async () => (await summary(id)).autoArchivedDays === 2);
    } finally {
      sweep.stop();
    }
  });
});
