import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { permissionFor } from '@spark-outpost/contracts';
import { insertChatWorktree } from '../src/persistence/chat-worktrees.ts';
import { sendUserMessage } from '../src/persistence/conversations.ts';
import { nativeTerminalTarget } from '../src/persistence/native-terminal-settings.ts';
import { updateProfile } from '../src/persistence/setup.ts';
import { publishScope } from '../src/workflow/publish-context.ts';
import { loadRunInput } from '../src/workflow/run-input.ts';
import { linkedConversation } from './approval-support.ts';
import { repoWithRemote } from './ship-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let base: string;
let root: string;
let conversationId: string;

beforeEach(async () => {
  t = await createTestDb();
  base = await realpath(await mkdtemp(path.join(tmpdir(), 'spark-terminal-publish-')));
  ({ root } = await repoWithRemote(base, 'widgets'));
  const linked = await linkedConversation(t, root);
  conversationId = linked.conversationId;
  await insertChatWorktree(t.db, {
    id: randomUUID(),
    conversationId,
    projectId: linked.projectId,
    repoRoot: root,
    path: root,
    branch: 'spark/notes-1a2b3c4d',
    baseBranch: 'main',
    baseCommit: 'a'.repeat(40),
    landedCommit: null,
    inPlace: false,
    ownsBranch: true,
  });
  await updateProfile(t.db, t.workspaceId, { defaultLevel: 'full-auto' });
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
  await t.cleanup();
});

async function scopeFor(sessionType: 'chat' | 'terminal', content: string) {
  await t.db.query(
    'UPDATE conversations SET session_type = $2, terminal_provider = $3 WHERE id = $1',
    [conversationId, sessionType, sessionType === 'terminal' ? 'claude' : null],
  );
  const target = await nativeTerminalTarget(t.db, conversationId, 'claude');
  const asking = {
    ...target,
    agentMode: 'default',
    permission: permissionFor('claude', 'default'),
  };
  const sent = await sendUserMessage(t.db, conversationId, { id: randomUUID(), content }, asking);
  await t.db.query("UPDATE runs SET status = 'succeeded' WHERE id = $1", [sent.run.id]);
  const input = await loadRunInput(t.db, sent.run.id);
  return {
    level: input.level,
    scope: await publishScope(t.db, { ...input, agentMode: 'default' }),
  };
}

it('gives a Terminal session no standing publish authority at Full auto → PR', async () => {
  const chat = await scopeFor('chat', 'Tidy the notes.');
  expect(chat.level).toBe('full-auto');
  expect(chat.scope).toMatchObject({ basis: 'full_auto' });
  const terminal = await scopeFor('terminal', 'Tidy the notes.');
  expect(terminal.level).toBe('hands-off');
  expect(terminal.scope).toBeNull();
});

it('still lets a Terminal session publish when the message asks for it', async () => {
  const asked = await scopeFor('terminal', 'Tidy the notes and open a pull request.');
  expect(asked.scope).toMatchObject({ basis: 'requested' });
});
