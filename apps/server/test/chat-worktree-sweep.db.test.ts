import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { insertChatWorktree, type ChatWorktree } from '../src/persistence/chat-worktrees.ts';
import { setConversationProjects } from '../src/persistence/conversation-projects.ts';
import { createConversation } from '../src/persistence/conversations.ts';
import { sweepChatWorktrees, type Exclusive } from '../src/projects/chat-worktree-sweep.ts';
import { addChatWorktree } from '../src/projects/chat-worktrees.ts';
import { createProject } from '../src/projects/projects.ts';
import { worktreePath } from '../src/projects/worktrees.ts';
import { sendDo } from './approval-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let base: string;
let root: string;
let projectId: string;

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-C', cwd, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
    encoding: 'utf8',
  }).trim();

const directly: Exclusive = (work) => work();

beforeEach(async () => {
  t = await createTestDb();
  base = await realpath(await mkdtemp(join(tmpdir(), 'spark-worktree-sweep-')));
  root = join(base, 'repo');
  execFileSync('git', ['init', '-q', '-b', 'main', root]);
  await writeFile(join(root, 'notes.txt'), 'one\n');
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'start');
  ({
    project: { id: projectId },
  } = await createProject(t.db, t.workspaceId, root));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(base, { recursive: true, force: true });
  await t.cleanup();
});

async function chatWithWorktree(name: string, path?: string): Promise<ChatWorktree> {
  const conversation = await createConversation(t.db, t.workspaceId, randomUUID());
  await setConversationProjects(t.db, t.workspaceId, conversation.id, [projectId]);
  const id = randomUUID();
  const branch = `spark/${name}`;
  const from = git(root, 'rev-parse', 'HEAD');
  if (!path) await addChatWorktree(root, worktreePath(root, id), { kind: 'new', branch, from });
  const record: ChatWorktree = {
    id,
    conversationId: conversation.id,
    projectId,
    repoRoot: root,
    path: path ?? worktreePath(root, id),
    branch,
    baseBranch: 'main',
    baseCommit: from,
    landedCommit: null,
    inPlace: false,
    ownsBranch: true,
  };
  await insertChatWorktree(t.db, record);
  return record;
}

async function archive(record: ChatWorktree): Promise<void> {
  await t.db.query('UPDATE conversations SET archived_at = now() WHERE id = $1', [
    record.conversationId,
  ]);
}

async function removedAt(record: ChatWorktree): Promise<Date | null> {
  const { rows } = await t.db.query<{ removed_at: Date | null }>(
    'SELECT removed_at FROM chat_worktrees WHERE id = $1',
    [record.id],
  );
  return rows[0]!.removed_at;
}

const sweep = (exclusive: Exclusive = directly) =>
  sweepChatWorktrees(t.db, exclusive, new AbortController().signal);

describe('sweeping chat worktrees', () => {
  it('removes an archived chat clean worktree and keeps one with changes', async () => {
    const clean = await chatWithWorktree('clean');
    const dirty = await chatWithWorktree('dirty');
    await writeFile(join(dirty.path, 'notes.txt'), 'one\nunsaved\n');
    await archive(clean);
    await archive(dirty);
    await sweep();
    expect(existsSync(clean.path)).toBe(false);
    expect(await removedAt(clean)).not.toBeNull();
    expect(await readFile(join(dirty.path, 'notes.txt'), 'utf8')).toBe('one\nunsaved\n');
    expect(await removedAt(dirty)).toBeNull();
  });

  it('leaves a worktree alone when its chat starts a turn before the release', async () => {
    const record = await chatWithWorktree('busy');
    await archive(record);
    const startsTurn: Exclusive = async (work) => {
      await sendDo(t, record.conversationId!, 'keep going');
      return work();
    };
    await sweep(startsTurn);
    expect(existsSync(record.path)).toBe(true);
    expect(await removedAt(record)).toBeNull();
  });

  it('keeps sweeping the other worktrees when one fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const notGit = await mkdtemp(join(base, 'not-git-'));
    const broken = await chatWithWorktree('broken', notGit);
    const clean = await chatWithWorktree('after-broken');
    await archive(broken);
    await archive(clean);
    await sweep();
    expect(console.error).toHaveBeenCalledWith(
      'Could not sweep the worktree on spark/broken',
      expect.any(Error),
    );
    expect(existsSync(notGit)).toBe(true);
    expect(existsSync(clean.path)).toBe(false);
    expect(await removedAt(clean)).not.toBeNull();
  });
});
