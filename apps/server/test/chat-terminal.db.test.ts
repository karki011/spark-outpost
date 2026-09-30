import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createShellResponseSchema,
  type CreateShellResponse,
  type TerminalServerMessage,
} from '@spark-outpost/contracts';
import { insertChatWorktree, markChatWorktreeRemoved } from '../src/persistence/chat-worktrees.ts';
import { createConversation } from '../src/persistence/conversations.ts';
import { loginShellSpawner } from '../src/terminal/pty.ts';
import { TerminalSessions } from '../src/terminal/sessions.ts';
import { createTestApp, localClient } from './app-support.ts';
import { linkedConversation } from './approval-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let base: string;
let root: string;
let terminals: TerminalSessions;
let client: ReturnType<typeof localClient>;

beforeEach(async () => {
  t = await createTestDb();
  base = realpathSync(mkdtempSync(path.join(tmpdir(), 'spark-chat-terminal-')));
  root = path.join(base, 'widgets');
  mkdirSync(root);
  terminals = new TerminalSessions(loginShellSpawner('/bin/sh'));
  client = localClient(createTestApp(t, { terminals }));
});

afterEach(async () => {
  terminals.killAll();
  rmSync(base, { recursive: true, force: true });
  await t.cleanup();
});

async function openShell(body: object = {}): Promise<CreateShellResponse> {
  const response = await client.send('post', '/api/terminal/shells', body);
  expect(response.status).toBe(201);
  return createShellResponseSchema.parse(response.body);
}

async function addWorktree(conversationId: string, projectId: string, inPlace = false) {
  const id = randomUUID();
  const folder = inPlace ? root : path.join(base, 'copies', id);
  if (!inPlace) mkdirSync(folder, { recursive: true });
  await insertChatWorktree(t.db, {
    id,
    conversationId,
    projectId,
    repoRoot: root,
    path: folder,
    branch: 'spark/fix-notes-1a2b3c4d',
    baseBranch: 'main',
    baseCommit: 'abc',
    landedCommit: null,
    inPlace,
    ownsBranch: true,
  });
  return { id, folder };
}

describe('chat terminal folders', () => {
  it('opens in the home folder when there is no chat or the chat has no project', async () => {
    const home = { cwd: homedir(), label: '~', kind: 'home', note: null };
    expect(await openShell()).toMatchObject(home);
    const bare = await createConversation(t.db, t.workspaceId, randomUUID());
    expect(await openShell({ conversationId: bare.id })).toMatchObject(home);
    expect(await openShell({ conversationId: randomUUID() })).toMatchObject(home);
  });

  it("opens in the chat's project folder when it has no worktree", async () => {
    const { conversationId, projectId } = await linkedConversation(t, root);
    expect(await openShell({ conversationId })).toMatchObject({
      cwd: root,
      label: 'my files · widgets',
      kind: 'project',
      note: null,
    });
    await addWorktree(conversationId, projectId, true);
    expect(await openShell({ conversationId })).toMatchObject({ cwd: root, kind: 'project' });
  });

  it("opens in the chat's live worktree", async () => {
    const { conversationId, projectId } = await linkedConversation(t, root);
    const { folder } = await addWorktree(conversationId, projectId);
    expect(await openShell({ conversationId })).toMatchObject({
      cwd: folder,
      label: 'spark/fix-notes-1a2b3c4d · worktree',
      kind: 'worktree',
      note: null,
    });
  });

  it('falls back to the project folder with a note when the worktree folder is gone', async () => {
    const { conversationId, projectId } = await linkedConversation(t, root);
    const { id, folder } = await addWorktree(conversationId, projectId);
    rmSync(folder, { recursive: true });
    const opened = await openShell({ conversationId });
    expect(opened).toMatchObject({ cwd: root, kind: 'project' });
    expect(opened.note).toContain('worktree for spark/fix-notes-1a2b3c4d was removed');

    await markChatWorktreeRemoved(t.db, id);
    expect(await openShell({ conversationId })).toMatchObject({ cwd: root, note: null });
  });

  it('falls back to home with a note when the project folder is gone', async () => {
    const { conversationId } = await linkedConversation(t, root);
    rmSync(root, { recursive: true });
    const opened = await openShell({ conversationId });
    expect(opened).toMatchObject({ cwd: homedir(), label: '~', kind: 'home' });
    expect(opened.note).toContain('widgets isn’t at');
  });

  it('never accepts a folder from the page', async () => {
    const { conversationId } = await linkedConversation(t, root);
    for (const body of [
      { cwd: '/etc' },
      { conversationId, cwd: '/etc' },
      { conversationId, path: '/etc' },
      { conversationId: '../../etc' },
    ]) {
      const response = await client.send('post', '/api/terminal/shells', body);
      expect(response.status).toBe(400);
    }
    expect(terminals.activeCount).toBe(0);
  });

  it("closes a chat's terminals when the chat is deleted", async () => {
    const { conversationId } = await linkedConversation(t, root);
    const opened = await openShell({ conversationId });
    const home = await openShell();
    const messages: TerminalServerMessage[] = [];
    terminals.attach(
      opened.id,
      opened.token,
      { output: () => undefined, send: (message) => messages.push(message), close: () => {} },
      { cols: 80, rows: 24 },
    );

    const deleted = await client.send('delete', `/api/conversations/${conversationId}`);
    expect(deleted.status).toBe(204);

    expect(messages.at(-1)).toEqual({ type: 'ended', reason: 'chat_removed', exitCode: null });
    expect(terminals.activeCount).toBe(1);
    expect(terminals.kill(home.id)).toBe(true);
  });
});
