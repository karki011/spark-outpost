import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gitControlGlobs, gitControlLabel, readGitDirs } from './git-dirs.ts';

let repo: string;
let worktree: string;

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-C', cwd, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
    encoding: 'utf8',
  });

beforeAll(() => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'spark-git-dirs-')));
  git(repo, 'init', '-q');
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'base');
  worktree = join(repo, '.spark', 'worktrees', 'chat-1');
  git(repo, 'worktree', 'add', '-q', '-b', 'spark/chat-1', worktree);
});

afterAll(() => rmSync(repo, { recursive: true, force: true }));

const rootOf = async (path: string) => ({ path, gitDirs: await readGitDirs(path) });

describe('readGitDirs()', () => {
  it('finds one git folder for a checkout', async () => {
    const common = join(repo, '.git');
    expect(await readGitDirs(repo)).toEqual({ common, own: common });
  });

  it("finds the checkout's git folder and the worktree's own one for a worktree", async () => {
    expect(await readGitDirs(worktree)).toEqual({
      common: join(repo, '.git'),
      own: join(repo, '.git', 'worktrees', 'chat-1'),
    });
  });

  it('finds nothing in a folder that is not a repository', async () => {
    const plain = realpathSync(mkdtempSync(join(tmpdir(), 'spark-no-git-')));
    expect(await readGitDirs(plain)).toBeNull();
    rmSync(plain, { recursive: true, force: true });
  });
});

describe('gitControlGlobs()', () => {
  it('adds nothing for a checkout, which the folder-relative rules already cover', async () => {
    expect(gitControlGlobs([await rootOf(repo)])).toEqual([]);
  });

  it("names the real hooks, config and the worktree's own config for a worktree", async () => {
    expect(gitControlGlobs([await rootOf(worktree)])).toEqual([
      join(repo, '.git', 'hooks', '*'),
      join(repo, '.git', 'config'),
      join(repo, '.git', 'worktrees', 'chat-1', 'config.worktree'),
    ]);
  });

  it('names the git folder of a linked folder that sits below the top of its repository', async () => {
    const below = { path: join(repo, 'packages'), gitDirs: await readGitDirs(repo) };
    expect(gitControlGlobs([below])).toEqual([
      join(repo, '.git', 'hooks', '*'),
      join(repo, '.git', 'config'),
    ]);
  });

  it('names each git folder once when two worktrees share it', async () => {
    const roots = [await rootOf(worktree), await rootOf(worktree)];
    expect(gitControlGlobs(roots)).toHaveLength(3);
  });

  it('still names .git/hooks when core.hooksPath points somewhere else', async () => {
    git(repo, 'config', 'core.hooksPath', '.husky');
    expect(gitControlGlobs([await rootOf(worktree)])).toContain(join(repo, '.git', 'hooks', '*'));
    expect(gitControlGlobs([await rootOf(worktree)]).join(' ')).not.toContain('.husky');
    git(repo, 'config', '--unset', 'core.hooksPath');
  });
});

describe('gitControlLabel()', () => {
  it.each([
    ['.git/hooks/pre-commit', '.git/hooks/pre-commit'],
    ['.git/hooks/pre-push', '.git/hooks/pre-push'],
    ['.git/config', '.git/config'],
    ['.git/worktrees/chat-1/config.worktree', '.git/config.worktree'],
  ])('reads %s in the real git folder as %s', async (inside, label) => {
    expect(gitControlLabel([await rootOf(worktree)], join(repo, inside))).toBe(label);
  });

  it.each([
    '.git/HEAD',
    '.git/hooks',
    '.git/hooks/nested/pre-commit',
    '.git/info/exclude',
    '.git/worktrees/chat-1/HEAD',
    'notes.txt',
  ])('reads %s as no git hook or git config', async (inside) => {
    expect(gitControlLabel([await rootOf(worktree)], join(repo, inside))).toBeNull();
  });

  it('knows nothing about a root whose git folder was not read', () => {
    expect(gitControlLabel([{ path: worktree }], join(repo, '.git/config'))).toBeNull();
  });
});
