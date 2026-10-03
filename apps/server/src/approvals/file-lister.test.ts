import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { diskFiles } from './file-lister.ts';

let root: string;
const git = (...args: string[]) =>
  execFileSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args]);

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'spark-scripts-')));
  await writeFile(join(root, 'tool.py'), 'print(1)\n');
  await writeFile(join(root, 'edited.py'), 'print(1)\n');
  await writeFile(join(root, '.gitignore'), 'ignored.py\n');
  git('init', '-q');
  git('add', '.');
  git('commit', '-qm', 'base');
  await writeFile(join(root, 'edited.py'), 'print(open(".env").read())\n');
  await writeFile(join(root, 'new.py'), 'print(2)\n');
  await writeFile(join(root, 'ignored.py'), 'print(3)\n');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('diskFiles.script', () => {
  it('trusts only scripts committed and unchanged in git', async () => {
    expect(await diskFiles.script(join(root, 'tool.py'))).toEqual({
      text: 'print(1)\n',
      committed: true,
    });
    for (const name of ['edited.py', 'new.py', 'ignored.py']) {
      expect((await diskFiles.script(join(root, name)))?.committed).toBe(false);
    }
  });

  it('judges a link by the file it points to', async () => {
    await symlink(join(root, 'new.py'), join(root, 'link.py'));
    git('add', 'link.py');
    git('commit', '-qm', 'link');
    expect(await diskFiles.script(join(root, 'link.py'))).toEqual({
      text: 'print(2)\n',
      committed: false,
    });
  });

  it('returns nothing for a missing file or a folder', async () => {
    expect(await diskFiles.script(join(root, 'missing.py'))).toBeNull();
    expect(await diskFiles.script(root)).toBeNull();
  });

  it('does not trust a script outside any repository', async () => {
    const outside = await realpath(await mkdtemp(join(tmpdir(), 'spark-loose-')));
    try {
      await writeFile(join(outside, 'x.py'), 'print(4)\n');
      expect((await diskFiles.script(join(outside, 'x.py')))?.committed).toBe(false);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

describe('diskFiles listing', () => {
  it('globs and walks the tree, skipping node_modules and .git', async () => {
    await mkdir(join(root, 'node_modules', 'pkg'), { recursive: true });
    await writeFile(join(root, 'node_modules', 'pkg', 'index.js'), '');
    await mkdir(join(root, 'src'));
    await writeFile(join(root, 'src', 'a.py'), '');
    expect((await diskFiles.glob('*.py', root))?.sort()).toEqual(
      ['edited.py', 'ignored.py', 'new.py', 'tool.py'].map((name) => join(root, name)),
    );
    const walked = await diskFiles.walk(root);
    expect(walked).toContain(join(root, 'src', 'a.py'));
    expect(walked?.some((file) => file.includes('node_modules') || file.includes('.git/'))).toBe(
      false,
    );
    expect(await diskFiles.walk(join(root, 'tool.py'))).toEqual([join(root, 'tool.py')]);
    expect(await diskFiles.walk(join(root, 'missing'))).toEqual([]);
  });
});
