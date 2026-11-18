import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ChatWorktree } from '../persistence/chat-worktrees.ts';
import { keptIgnoredNote, releaseOnDisk } from './chat-worktree-cleanup.ts';
import { addChatWorktree, branchTipOf } from './chat-worktrees.ts';
import { ignoredEntryMatters, ignoredFilesThatMatter } from './worktree-ignored.ts';
import { worktreePath } from './worktrees.ts';

let root: string;

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-C', cwd, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
    encoding: 'utf8',
  }).trim();

beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), 'spark-worktree-ignored-')));
  git(root, 'init', '-q', '-b', 'main');
  await writeFile(
    path.join(root, '.gitignore'),
    ['.env*', 'node_modules/', 'dist/', '*.log', '.DS_Store', 'local/', 'data.sqlite'].join('\n'),
  );
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'start');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function chatCopy(): Promise<ChatWorktree> {
  const id = '11111111-2222-4333-8444-666666666666';
  const base = git(root, 'rev-parse', 'HEAD');
  const branch = 'spark/chat-ignored';
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

async function put(folder: string, relative: string, text = 'x\n'): Promise<void> {
  await mkdir(path.dirname(path.join(folder, relative)), { recursive: true });
  await writeFile(path.join(folder, relative), text);
}

describe('which ignored files matter', () => {
  it('drops build output, dependencies, logs and Finder files', () => {
    expect(ignoredEntryMatters('node_modules/')).toBe(false);
    expect(ignoredEntryMatters('apps/web/node_modules/')).toBe(false);
    expect(ignoredEntryMatters('apps/web/.next/cache/x')).toBe(false);
    expect(ignoredEntryMatters('target/debug/app')).toBe(false);
    expect(ignoredEntryMatters('.spark/')).toBe(false);
    expect(ignoredEntryMatters('server.log')).toBe(false);
    expect(ignoredEntryMatters('docs/.DS_Store')).toBe(false);
    expect(ignoredEntryMatters('tsconfig.tsbuildinfo')).toBe(false);
    expect(ignoredEntryMatters('test-results/')).toBe(false);
    expect(ignoredEntryMatters('.eslintcache')).toBe(false);
  });

  it('keeps secrets, local config, certificates and databases', () => {
    expect(ignoredEntryMatters('.env')).toBe(true);
    expect(ignoredEntryMatters('apps/api/.env.local')).toBe(true);
    expect(ignoredEntryMatters('local/')).toBe(true);
    expect(ignoredEntryMatters('certs/dev.pem')).toBe(true);
    expect(ignoredEntryMatters('data.sqlite')).toBe(true);
    expect(ignoredEntryMatters('distribution.md')).toBe(true);
  });

  it('lists what git ignores in a worktree, without regenerable files', async () => {
    const copy = await chatCopy();
    await put(copy.path, '.env', 'API_KEY=1\n');
    await put(copy.path, 'node_modules/pkg/index.js');
    await put(copy.path, 'dist/app.js');
    await put(copy.path, 'debug.log');
    await put(copy.path, 'local/settings.json');
    expect(await ignoredFilesThatMatter(copy.path)).toEqual(['.env', 'local/']);
  });
});

describe('releasing a worktree with ignored files', () => {
  it('keeps an archived worktree that holds an ignored .env', async () => {
    const copy = await chatCopy();
    await put(copy.path, '.env', 'API_KEY=1\n');
    const released = await releaseOnDisk(copy, 'archived');
    expect(released).toMatchObject({ removed: false, ignoredKept: ['.env'] });
    expect(existsSync(path.join(copy.path, '.env'))).toBe(true);
    expect(keptIgnoredNote(copy, released)).toBe(
      `Kept the spark/chat-ignored worktree at ${copy.path}: it holds files git ignores (.env).`,
    );
  });

  it('keeps the worktree, unsaved, when a chat with ignored files is deleted', async () => {
    const copy = await chatCopy();
    await put(copy.path, 'data.sqlite');
    await put(copy.path, 'work.txt');
    const released = await releaseOnDisk(copy, 'deleted');
    expect(released).toMatchObject({ removed: false, saved: false, ignoredKept: ['data.sqlite'] });
    expect(existsSync(path.join(copy.path, 'work.txt'))).toBe(true);
    expect(await branchTipOf(root, copy.branch)).toBe(copy.baseCommit);
  });

  it('removes a worktree whose only ignored files are regenerable', async () => {
    const copy = await chatCopy();
    await put(copy.path, 'node_modules/pkg/index.js');
    await put(copy.path, 'dist/app.js');
    await put(copy.path, 'debug.log');
    const released = await releaseOnDisk(copy, 'merged');
    expect(released).toMatchObject({ removed: true, ignoredKept: [] });
    expect(existsSync(copy.path)).toBe(false);
  });

  it('names five files and counts the rest', async () => {
    const copy = await chatCopy();
    for (const name of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) await put(copy.path, `.env.${name}`);
    const released = await releaseOnDisk(copy, 'reset');
    expect(keptIgnoredNote(copy, released)).toContain(
      '(.env.a, .env.b, .env.c, .env.d, .env.e and 2 more)',
    );
  });
});
