import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { git, write } from '../../test/ship-support.ts';
import { commitOnBranch, filesAgainst } from './git.ts';

const bases: string[] = [];

afterEach(async () => {
  await Promise.all(bases.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function subfolderProject(): Promise<{ repo: string; project: string; start: string }> {
  const repo = await mkdtemp(path.join(tmpdir(), 'ship-subfolder-'));
  bases.push(repo);
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.name', 'Test Person');
  git(repo, 'config', 'user.email', 'test@example.test');
  git(repo, 'config', 'commit.gpgsign', 'false');
  await write(repo, 'app/keep.ts', 'keep\n');
  await write(repo, 'app/gone.ts', 'gone\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-qm', 'start');
  await rm(path.join(repo, 'app/gone.ts'));
  return { repo, project: path.join(repo, 'app'), start: git(repo, 'rev-parse', 'HEAD') };
}

describe('ship git index in a project that is a subfolder of the repo', () => {
  it('lists a deleted tracked file', async () => {
    const { project, start } = await subfolderProject();
    expect(await filesAgainst(project, 'app/', ['gone.ts'], start)).toEqual([
      { path: 'gone.ts', change: 'deleted' },
    ]);
  });

  it('commits a deleted tracked file', async () => {
    const { repo, project, start } = await subfolderProject();
    const commit = await commitOnBranch(project, 'app/', ['gone.ts'], 'task', start, 'Remove', '');
    expect(commit).not.toBeNull();
    expect(git(repo, 'ls-tree', '-r', '--name-only', 'task')).toBe('app/keep.ts');
  });
});
