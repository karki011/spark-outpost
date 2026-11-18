import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { appendFile, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { insertChatWorktree, sweepableChatWorktrees } from '../src/persistence/chat-worktrees.ts';
import { releaseConversation } from '../src/projects/chat-worktree-cleanup.ts';
import { sweepChatWorktrees } from '../src/projects/chat-worktree-sweep.ts';
import { addChatWorktree } from '../src/projects/chat-worktrees.ts';
import { worktreePath } from '../src/projects/worktrees.ts';
import { linkedConversation } from './approval-support.ts';
import { createTestDb, type TestDb } from './support.ts';
import { gitRepo, removeRepo } from './turn-support.ts';

let t: TestDb;
let root: string;

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();

beforeEach(async () => {
  t = await createTestDb();
  root = await gitRepo();
  await appendFile(join(root, '.git', 'info', 'exclude'), '.env\nnode_modules/\n');
});

afterEach(async () => {
  await t.cleanup();
  await removeRepo(root);
});

async function sweep(): Promise<void> {
  await sweepChatWorktrees(t.db, (work) => work(), new AbortController().signal);
}

async function chatWithWorktree() {
  const { conversationId, projectId } = await linkedConversation(t, root);
  const id = randomUUID();
  const path = worktreePath(root, id);
  const branch = `spark/ignored-${id.slice(0, 8)}`;
  const base = git(root, 'rev-parse', 'HEAD');
  await addChatWorktree(root, path, { kind: 'new', branch, from: base });
  await insertChatWorktree(t.db, {
    id,
    conversationId,
    projectId,
    repoRoot: root,
    path,
    branch,
    baseBranch: null,
    baseCommit: base,
    landedCommit: null,
    inPlace: false,
    ownsBranch: true,
  });
  return { conversationId, id, path, branch };
}

async function archive(conversationId: string): Promise<void> {
  await t.db.query('UPDATE conversations SET archived_at = clock_timestamp() WHERE id = $1', [
    conversationId,
  ]);
}

async function openShellIn(cwd: string): Promise<string> {
  const id = randomUUID();
  await t.db.query(
    `INSERT INTO terminal_shells (id, workspace_id, label, cwd, pid) VALUES ($1, $2, 'zsh', $3, 1)`,
    [id, t.workspaceId, cwd],
  );
  return id;
}

async function sweepableIds(): Promise<string[]> {
  return (await sweepableChatWorktrees(t.db)).map((record) => record.id);
}

async function commitCount(branch: string): Promise<string> {
  return git(root, 'rev-list', '--count', branch);
}

describe('chat worktrees that hold files git ignores', () => {
  it('keeps an ignored .env when the chat is archived, across repeated sweeps', async () => {
    const chat = await chatWithWorktree();
    await writeFile(join(chat.path, '.env'), 'API_KEY=1\n');
    await archive(chat.conversationId);
    const commits = await commitCount(chat.branch);

    await sweep();
    await sweep();

    expect(existsSync(join(chat.path, '.env'))).toBe(true);
    expect(await commitCount(chat.branch)).toBe(commits);
    expect(await sweepableIds()).toEqual([]);
  });

  it('removes a worktree whose only ignored files are dependencies', async () => {
    const chat = await chatWithWorktree();
    await mkdir(join(chat.path, 'node_modules', 'pkg'), { recursive: true });
    await writeFile(join(chat.path, 'node_modules', 'pkg', 'index.js'), 'x\n');
    await archive(chat.conversationId);

    await sweep();

    expect(existsSync(chat.path)).toBe(false);
  });

  it('still removes a clean worktree, and a second sweep changes nothing', async () => {
    const chat = await chatWithWorktree();
    await archive(chat.conversationId);

    await sweep();
    await sweep();

    expect(existsSync(chat.path)).toBe(false);
    expect(await sweepableIds()).toEqual([]);
  });

  it('keeps the worktree of a deleted chat with an ignored .env and stops rechecking it', async () => {
    const chat = await chatWithWorktree();
    await writeFile(join(chat.path, '.env'), 'API_KEY=1\n');

    await releaseConversation(t.db, chat.conversationId, 'deleted');
    await t.db.query('DELETE FROM conversations WHERE id = $1', [chat.conversationId]);

    expect(existsSync(join(chat.path, '.env'))).toBe(true);
    expect(await sweepableIds()).toEqual([]);
    await sweep();
    expect(existsSync(join(chat.path, '.env'))).toBe(true);
  });
});

describe('chat worktrees that something still runs in', () => {
  it('leaves the worktree while a shell tab runs inside it, and removes it once it ends', async () => {
    const chat = await chatWithWorktree();
    const shell = await openShellIn(join(chat.path, 'apps'));
    await archive(chat.conversationId);

    await sweep();
    expect(existsSync(chat.path)).toBe(true);
    expect(await sweepableIds()).toEqual([chat.id]);

    await t.db.query('DELETE FROM terminal_shells WHERE id = $1', [shell]);
    await sweep();
    expect(existsSync(chat.path)).toBe(false);
  });

  it('is not blocked by a shell in a folder that only shares the name prefix', async () => {
    const chat = await chatWithWorktree();
    await openShellIn(`${chat.path}-other`);
    await archive(chat.conversationId);

    await sweep();

    expect(existsSync(chat.path)).toBe(false);
  });

  it('retries a deleted chat whose shell tab was still closing', async () => {
    const chat = await chatWithWorktree();
    const shell = await openShellIn(chat.path);

    await releaseConversation(t.db, chat.conversationId, 'deleted');
    await t.db.query('DELETE FROM conversations WHERE id = $1', [chat.conversationId]);
    expect(existsSync(chat.path)).toBe(true);
    expect(await sweepableIds()).toEqual([chat.id]);

    await t.db.query('DELETE FROM terminal_shells WHERE id = $1', [shell]);
    await sweep();
    expect(existsSync(chat.path)).toBe(false);
  });

  it('matches a shell recorded under the worktree path reached through a symlink', async () => {
    const link = await mkdtemp(join(tmpdir(), 'spark-link-'));
    const linked = join(link, 'repo');
    await symlink(root, linked);
    const chat = await chatWithWorktree();
    await t.db.query('UPDATE chat_worktrees SET path = $2 WHERE id = $1', [
      chat.id,
      chat.path.replace(root, linked),
    ]);
    await openShellIn(chat.path);
    await archive(chat.conversationId);

    await sweep();

    expect(existsSync(chat.path)).toBe(true);
    await rm(link, { recursive: true, force: true });
  });

  it('leaves the worktree while an agent terminal runs inside it', async () => {
    const chat = await chatWithWorktree();
    await t.db.query(
      `INSERT INTO agent_terminals (id, workspace_id, conversation_id, provider, name, command, cwd, decided_by)
       VALUES ($1, $2, $3, 'claude', 'dev', 'pnpm dev', $4, 'mode')`,
      [randomUUID(), t.workspaceId, chat.conversationId, chat.path],
    );
    await archive(chat.conversationId);

    await sweep();

    expect(existsSync(chat.path)).toBe(true);
  });
});
