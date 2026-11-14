import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ApprovalOption } from '@spark-outpost/contracts';
import { decideApproval, insertApproval } from '../src/persistence/approvals.ts';
import { sendUserMessage } from '../src/persistence/conversations.ts';
import { outsideWriteGranted, outsideWriteSession } from '../src/workflow/outside-write-grant.ts';
import { createTestDb, startChat, type TestDb } from './support.ts';

let t: TestDb;
let chat: { conversationId: string; runId: string };

const OPTIONS: ApprovalOption[] = [
  { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
  { optionId: 'deny', name: 'Deny', kind: 'reject_once' },
];

async function setRun(runId: string, provider: string, mode: string, source = 'ui') {
  await t.db.query(
    'UPDATE runs SET provider = $2, agent_mode = $3, used_mode = $3, source = $4 WHERE id = $1',
    [runId, provider, mode, source],
  );
}

async function openSession(provider = 'claude'): Promise<string> {
  await t.db.query(
    `UPDATE provider_sessions SET closed_at = now(), close_reason = 'replaced'
     WHERE conversation_id = $1 AND closed_at IS NULL`,
    [chat.conversationId],
  );
  const id = randomUUID();
  await t.db.query(
    `INSERT INTO provider_sessions
       (id, conversation_id, provider, agent_key, session_id, cwd, settings_hash, last_used_at)
     VALUES ($1, $2, $3, 'chat:do', $4, '/tmp', 'h', now())`,
    [id, chat.conversationId, provider, randomUUID()],
  );
  return id;
}

async function nextTurn(provider = 'claude', mode = 'acceptEdits'): Promise<string> {
  const sent = await sendUserMessage(
    t.db,
    chat.conversationId,
    { id: randomUUID(), content: 'next' },
    { provider: 'fake' },
    t.workspaceId,
  );
  await setRun(sent.run.id, provider, mode);
  return sent.run.id;
}

async function outsideCard(runId: string, outsideWrite: string, kind = 'edit') {
  return insertApproval(t.db, {
    runId,
    toolCallId: randomUUID(),
    rpcId: null,
    kind: kind as 'edit',
    title: 'Edit notes.md',
    payload: {
      command: null,
      cwd: '/work/app',
      paths: ['~/notes.md'],
      diffs: [],
      truncated: false,
      outsideWrite,
    },
    options: OPTIONS,
    reason: 'This changes ~/notes.md, which is outside this project',
  });
}

beforeEach(async () => {
  t = await createTestDb();
  chat = await startChat(t, 'write my notes');
  await setRun(chat.runId, 'claude', 'acceptEdits');
});

afterEach(async () => {
  await t.cleanup();
});

describe('Allow for this session on a write outside the project', () => {
  it('covers later turns in the same session and nothing before it is answered', async () => {
    const session = await openSession();
    const card = await outsideCard(chat.runId, session);
    expect(await outsideWriteGranted(t.db, chat.runId)).toBe(false);
    await decideApproval(t.db, t.workspaceId, card.id, { optionId: 'allow', scope: 'chat' });
    expect(await outsideWriteGranted(t.db, chat.runId)).toBe(true);
    expect(await outsideWriteGranted(t.db, await nextTurn())).toBe(true);
  });

  it('ends when the session is replaced, the mode changes or the agent changes', async () => {
    const card = await outsideCard(chat.runId, await openSession());
    await decideApproval(t.db, t.workspaceId, card.id, { optionId: 'allow', scope: 'chat' });
    await openSession();
    expect(await outsideWriteGranted(t.db, await nextTurn())).toBe(false);

    const again = await outsideCard(chat.runId, await openSession());
    await decideApproval(t.db, t.workspaceId, again.id, { optionId: 'allow', scope: 'chat' });
    expect(await outsideWriteGranted(t.db, await nextTurn('claude', 'default'))).toBe(false);
    expect(await outsideWriteGranted(t.db, await nextTurn())).toBe(false);
    expect(await outsideWriteGranted(t.db, await nextTurn('codex', 'acceptEdits'))).toBe(false);
  });

  it('does not come from Allow once or from a card in another chat', async () => {
    const session = await openSession();
    const once = await outsideCard(chat.runId, session);
    await decideApproval(t.db, t.workspaceId, once.id, { optionId: 'allow', scope: 'once' });
    expect(await outsideWriteGranted(t.db, chat.runId)).toBe(false);

    const own = chat;
    chat = await startChat(t, 'another chat');
    await setRun(chat.runId, 'claude', 'acceptEdits');
    const elsewhere = await outsideCard(chat.runId, await openSession());
    await decideApproval(t.db, t.workspaceId, elsewhere.id, { optionId: 'allow', scope: 'chat' });
    chat = own;
    expect(await outsideWriteGranted(t.db, chat.runId)).toBe(false);
  });

  it('does not apply to a turn the user did not type', async () => {
    const card = await outsideCard(chat.runId, await openSession());
    await decideApproval(t.db, t.workspaceId, card.id, { optionId: 'allow', scope: 'chat' });
    const later = await nextTurn();
    await setRun(later, 'claude', 'acceptEdits', 'assistant');
    expect(await outsideWriteGranted(t.db, later)).toBe(false);
  });

  it('is offered only on a typed turn with an open session', async () => {
    expect(await outsideWriteSession(t.db, chat.runId)).toBeNull();
    const session = await openSession();
    expect(await outsideWriteSession(t.db, chat.runId)).toBe(session);
    const later = await nextTurn();
    await setRun(later, 'claude', 'acceptEdits', 'assistant');
    expect(await outsideWriteSession(t.db, later)).toBeNull();
  });

  it('refuses a longer grant on any other card', async () => {
    const plain = await insertApproval(t.db, {
      runId: chat.runId,
      toolCallId: randomUUID(),
      rpcId: null,
      kind: 'edit',
      title: 'Edit a.ts',
      payload: { command: null, cwd: '/work/app', paths: ['a.ts'], diffs: [], truncated: false },
      options: OPTIONS,
      reason: null,
    });
    await expect(
      decideApproval(t.db, t.workspaceId, plain.id, { optionId: 'allow', scope: 'chat' }),
    ).rejects.toThrow(/can be allowed for longer/);
  });
});
