import { execFileSync } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { revertTargets, staysInside } from './file-revert.ts';
import { revertGitChanges } from './snapshot.ts';

let base: string;
let root: string;
let outside: string;

beforeEach(async () => {
  base = await realpath(await mkdtemp(path.join(tmpdir(), 'spark-file-revert-')));
  root = path.join(base, 'repo');
  outside = path.join(base, 'elsewhere');
  await mkdir(path.join(root, 'src'), { recursive: true });
  await mkdir(outside);
  await symlink(outside, path.join(root, 'linked'));
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe('where a file revert may write', () => {
  it('allows files inside the project, even in folders that no longer exist', async () => {
    expect(await staysInside(root, 'src/app.ts')).toBe(true);
    expect(await staysInside(root, 'made/deep/new.txt')).toBe(true);
  });

  it('refuses paths that leave the project, through .. or a linked folder', async () => {
    expect(await staysInside(root, '../elsewhere/file.txt')).toBe(false);
    expect(await staysInside(root, 'linked/file.txt')).toBe(false);
    expect(await staysInside(root, 'linked/deeper/file.txt')).toBe(false);
  });

  it('refuses git’s own folder, hooks and config', async () => {
    expect(await staysInside(root, '.git/config')).toBe(false);
    expect(await staysInside(root, '.git/hooks/pre-commit')).toBe(false);
  });
});

describe('what reverting one listed file touches', () => {
  it('is the file itself for an edit, an addition or a deletion', () => {
    expect(revertTargets({ path: 'a.ts', change: 'modified' })).toEqual([
      { path: 'a.ts', change: 'modified' },
    ]);
    expect(revertTargets({ path: 'b.ts', change: 'added' })).toEqual([
      { path: 'b.ts', change: 'added' },
    ]);
  });

  it('is both names for a rename: the old one comes back and the new one goes', () => {
    expect(revertTargets({ path: 'new.ts', change: 'modified', oldPath: 'old.ts' })).toEqual([
      { path: 'old.ts', change: 'deleted' },
      { path: 'new.ts', change: 'added' },
    ]);
  });
});

describe('undoing a rename that only changed case', () => {
  it('removes the new name before restoring the old one, so the file survives', async () => {
    const run = (...args: string[]) =>
      execFileSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args]);
    await writeFile(path.join(root, 'foo.txt'), 'original\n');
    run('init', '-q');
    run('add', 'foo.txt');
    run('commit', '-qm', 'base');
    await rename(path.join(root, 'foo.txt'), path.join(root, 'Foo.txt'));

    const targets = revertTargets({ path: 'Foo.txt', change: 'modified', oldPath: 'foo.txt' });
    await revertGitChanges(root, 'HEAD', targets);

    expect(await readFile(path.join(root, 'foo.txt'), 'utf8')).toBe('original\n');
  });
});
