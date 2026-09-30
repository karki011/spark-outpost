import { execFileSync } from 'node:child_process';
import { mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { diskLister } from './file-lister.ts';

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

describe('diskLister.script', () => {
  it('trusts only scripts committed and unchanged in git', () => {
    expect(diskLister.script(join(root, 'tool.py'))).toEqual({
      text: 'print(1)\n',
      committed: true,
    });
    for (const name of ['edited.py', 'new.py', 'ignored.py']) {
      expect(diskLister.script(join(root, name))?.committed).toBe(false);
    }
  });

  it('judges a link by the file it points to', async () => {
    await symlink(join(root, 'new.py'), join(root, 'link.py'));
    git('add', 'link.py');
    git('commit', '-qm', 'link');
    expect(diskLister.script(join(root, 'link.py'))).toEqual({
      text: 'print(2)\n',
      committed: false,
    });
  });

  it('returns nothing for a missing file or a folder', () => {
    expect(diskLister.script(join(root, 'missing.py'))).toBeNull();
    expect(diskLister.script(root)).toBeNull();
  });

  it('does not trust a script outside any repository', async () => {
    const outside = await realpath(await mkdtemp(join(tmpdir(), 'spark-loose-')));
    try {
      await writeFile(join(outside, 'x.py'), 'print(4)\n');
      expect(diskLister.script(join(outside, 'x.py'))?.committed).toBe(false);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});
