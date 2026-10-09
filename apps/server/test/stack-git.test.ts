import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NO_REMOTE, stackGit } from '../src/outposts/stack-git.ts';
import { git, repoWithRemote, write, type TestRepo } from './ship-support.ts';

const PARENT = 'spark/api-1a2b3c4d';
const CHILD = 'spark/web-5e6f7a8b';

let base: string;
let repo: TestRepo;

async function commitOn(branch: string, file: string): Promise<void> {
  git(repo.root, 'checkout', '-q', branch);
  await write(repo.root, file, `${file}\n`);
  git(repo.root, 'add', '.');
  git(repo.root, 'commit', '-qm', `add ${file}`);
}

beforeEach(async () => {
  base = await realpath(await mkdtemp(path.join(tmpdir(), 'spark-stack-git-')));
  repo = await repoWithRemote(base, 'shop');
  git(repo.root, 'branch', PARENT);
  await commitOn(PARENT, 'api.ts');
  git(repo.root, 'branch', CHILD, PARENT);
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe('what Spark reads from the repository about a stack', () => {
  it("knows whether the child holds the parent's commits", async () => {
    expect(await stackGit.isAncestor(repo.root, PARENT, CHILD)).toBe(true);
    await commitOn(PARENT, 'more.ts');
    expect(await stackGit.isAncestor(repo.root, PARENT, CHILD)).toBe(false);
    git(repo.root, 'checkout', '-q', CHILD);
    git(repo.root, 'merge', '-q', '--no-edit', PARENT);
    expect(await stackGit.isAncestor(repo.root, PARENT, CHILD)).toBe(true);
  });

  it('does not answer for a branch that is not there', async () => {
    await expect(stackGit.isAncestor(repo.root, 'spark/gone', CHILD)).rejects.toThrow(
      'Could not compare spark/gone',
    );
  });

  it('sees the parent on the remote only after it is pushed', async () => {
    expect(await stackGit.branchOnRemote(repo.root, PARENT)).toBe(false);
    git(repo.root, 'push', '-q', 'origin', PARENT);
    expect(await stackGit.branchOnRemote(repo.root, PARENT)).toBe(true);
    expect(await stackGit.branchOnRemote(repo.root, CHILD)).toBe(false);
  });

  it('does not answer about the remote when the repository has none', async () => {
    const alone = await repoWithRemote(base, 'alone', 'none');
    await expect(stackGit.branchOnRemote(alone.root, 'main')).rejects.toThrow(NO_REMOTE);
  });

  it('finds a branch that is local or only on the remote, and misses a deleted one', async () => {
    expect(await stackGit.hasBranch(repo.root, PARENT)).toBe(true);
    git(repo.root, 'push', '-q', 'origin', PARENT);
    git(repo.root, 'checkout', '-q', 'main');
    git(repo.root, 'branch', '-qD', CHILD, PARENT);
    expect(await stackGit.hasBranch(repo.root, PARENT)).toBe(true);
    expect(await stackGit.hasBranch(repo.root, CHILD)).toBe(false);
  });

  it("reads the repository's default branch", async () => {
    expect(await stackGit.defaultBranch(repo.root)).toBe('main');
    const trunk = path.join(base, 'trunk');
    git(base, 'init', '-q', '-b', 'trunk', trunk);
    expect(await stackGit.defaultBranch(trunk)).toBeNull();
  });
});
