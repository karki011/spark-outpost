import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ChatWorktree } from '../persistence/chat-worktrees.ts';
import { releaseOnDisk } from './chat-worktree-cleanup.ts';
import { addChatWorktree, bringChanges, branchTipOf, listBranches } from './chat-worktrees.ts';
import { worktreePath } from './worktrees.ts';

let root: string;

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-C', cwd, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
    encoding: 'utf8',
  }).trim();

beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), 'spark-chat-worktree-')));
  git(root, 'init', '-q', '-b', 'main');
  await writeFile(path.join(root, 'notes.txt'), 'one\ntwo\nthree\n');
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'start');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function chatCopy(branch = 'spark/chat-1'): Promise<ChatWorktree> {
  const id = '11111111-2222-4333-8444-555555555555';
  const base = git(root, 'rev-parse', 'HEAD');
  await addChatWorktree(root, worktreePath(root, id), { kind: 'new', branch, from: base });
  return {
    id,
    conversationId: null,
    projectId: id,
    repoRoot: root,
    path: worktreePath(root, id),
    branch,
    baseBranch: 'main',
    baseCommit: base,
    landedCommit: null,
    inPlace: false,
    ownsBranch: true,
  };
}

describe('bringing a chat worktree into the checkout', () => {
  it('applies the changes as uncommitted edits on the current branch', async () => {
    const copy = await chatCopy();
    await writeFile(path.join(copy.path, 'notes.txt'), 'one\ntwo\nthree\nfour\n');
    await writeFile(path.join(copy.path, 'added.txt'), 'new\n');
    const outcome = await bringChanges(root, copy.path, copy.baseCommit);
    expect(outcome).toMatchObject({ status: 'applied' });
    expect(outcome.status === 'applied' && outcome.files.sort()).toEqual([
      'added.txt',
      'notes.txt',
    ]);
    expect(await readFile(path.join(root, 'notes.txt'), 'utf8')).toBe('one\ntwo\nthree\nfour\n');
    expect(git(root, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');
    expect(git(root, 'rev-list', '--count', 'HEAD')).toBe('1');
  });

  it('refuses while the checkout has uncommitted changes', async () => {
    const copy = await chatCopy();
    await writeFile(path.join(copy.path, 'notes.txt'), 'changed in the chat\n');
    await writeFile(path.join(root, 'mine.txt'), 'my edit\n');
    expect(await bringChanges(root, copy.path, copy.baseCommit)).toEqual({
      status: 'dirty',
      files: ['mine.txt'],
    });
    expect(await readFile(path.join(root, 'notes.txt'), 'utf8')).toBe('one\ntwo\nthree\n');
  });

  it('refuses when the same lines changed on both sides', async () => {
    const copy = await chatCopy();
    await writeFile(path.join(copy.path, 'notes.txt'), 'one\nTWO from the chat\nthree\n');
    await writeFile(path.join(root, 'notes.txt'), 'one\nTWO from me\nthree\n');
    git(root, 'commit', '-qam', 'mine');
    expect(await bringChanges(root, copy.path, copy.baseCommit)).toEqual({
      status: 'conflict',
      files: ['notes.txt'],
    });
    expect(await readFile(path.join(root, 'notes.txt'), 'utf8')).toBe('one\nTWO from me\nthree\n');
  });

  it('brings only what changed since the last time', async () => {
    const copy = await chatCopy();
    await writeFile(path.join(copy.path, 'a.txt'), 'a\n');
    const first = await bringChanges(root, copy.path, copy.baseCommit);
    if (first.status !== 'applied') throw new Error(first.status);
    git(root, 'add', '.');
    git(root, 'commit', '-qm', 'took a');
    await writeFile(path.join(copy.path, 'b.txt'), 'b\n');
    const second = await bringChanges(root, copy.path, first.result);
    expect(second.status === 'applied' && second.files).toEqual(['b.txt']);
  });
});

describe('releasing a chat worktree', () => {
  it('removes a clean worktree and its branch when nothing new is on it', async () => {
    const copy = await chatCopy();
    expect(await releaseOnDisk(copy, 'deleted')).toEqual({
      removed: true,
      branchKept: false,
      saved: false,
    });
    expect(existsSync(copy.path)).toBe(false);
    expect((await listBranches(root)).local).toEqual(['main']);
  });

  it('saves uncommitted work on the branch and keeps the branch when the chat is deleted', async () => {
    const copy = await chatCopy();
    await writeFile(path.join(copy.path, 'work.txt'), 'unpushed work\n');
    expect(await releaseOnDisk(copy, 'deleted')).toEqual({
      removed: true,
      branchKept: true,
      saved: true,
    });
    expect(existsSync(copy.path)).toBe(false);
    const tip = await branchTipOf(root, copy.branch);
    expect(git(root, 'show', `${tip}:work.txt`)).toBe('unpushed work');
  });

  it('keeps a worktree with uncommitted work when the chat is only archived', async () => {
    const copy = await chatCopy();
    await writeFile(path.join(copy.path, 'work.txt'), 'in progress\n');
    expect((await releaseOnDisk(copy, 'archived')).removed).toBe(false);
    expect(existsSync(path.join(copy.path, 'work.txt'))).toBe(true);
  });

  it('keeps a branch whose commits were never pushed or merged', async () => {
    const copy = await chatCopy();
    await writeFile(path.join(copy.path, 'done.txt'), 'done\n');
    git(copy.path, 'add', '.');
    git(copy.path, 'commit', '-qm', 'chat work');
    const released = await releaseOnDisk(copy, 'deleted');
    expect(released).toMatchObject({ removed: true, branchKept: true, saved: false });
    expect((await listBranches(root)).local).toContain(copy.branch);
  });

  it('never deletes a branch it did not create', async () => {
    git(root, 'branch', 'feature');
    const copy = { ...(await chatCopy('spark/other')), ownsBranch: false, branch: 'spark/other' };
    await releaseOnDisk(copy, 'deleted');
    expect((await listBranches(root)).local).toContain('spark/other');
  });
});
