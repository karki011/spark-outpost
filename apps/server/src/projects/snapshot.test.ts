import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { gitChanges, isVanishedFileError, takeGitSnapshot, workingTree } from './snapshot.ts';

let root: string;
const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'spark-snapshot-')));
  await writeFile(join(root, 'app.ts'), 'one\n');
  git('init', '-q');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '.');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'base');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function write(relative: string, text: string) {
  const target = join(root, relative);
  await mkdir(join(target, '..'), { recursive: true });
  await writeFile(target, text);
}

describe('git snapshots', () => {
  it('leaves node_modules and the dependency prep temp files out of the snapshot', async () => {
    await write('node_modules/.pnpm/_tmp_123_abc/index.js', 'temp\n');
    await write('packages/web/node_modules/left-pad/index.js', 'pad\n');
    await write('node_modules_notes.md', 'kept\n');
    const tree = await workingTree(root);
    const files = git('ls-tree', '-r', '--name-only', tree).trim().split('\n');
    expect(files.sort()).toEqual(['app.ts', 'node_modules_notes.md']);
  });

  it('reports only real changes after a snapshot while node_modules keep changing', async () => {
    const ref = await takeGitSnapshot(root, 'run-1');
    await write('node_modules/.pnpm/_tmp_456_def/package.json', '{}\n');
    await write('app.ts', 'two\n');
    expect(await gitChanges(root, ref)).toEqual([{ path: 'app.ts', change: 'modified' }]);
  });

  it('recognises a file that vanished while git was adding it', () => {
    const stderr =
      'error: open("node_modules/.pnpm/_tmp_1/x"): No such file or directory\n' +
      "error: unable to index file 'node_modules/.pnpm/_tmp_1/x'\nfatal: adding files failed\n";
    expect(isVanishedFileError({ stderr })).toBe(true);
    expect(isVanishedFileError({ stderr: 'fatal: not a git repository' })).toBe(false);
  });
});
