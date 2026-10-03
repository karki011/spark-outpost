import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SNAPSHOT_INDEX_NAME } from './snapshot-index.ts';
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

function freshTree(at: string = root): string {
  const scratch = execFileSync('mktemp', ['-d'], { encoding: 'utf8' }).trim();
  const env = { ...process.env, GIT_INDEX_FILE: join(scratch, 'index') };
  const run = (...args: string[]) =>
    execFileSync('git', ['-C', at, ...args], { encoding: 'utf8', env }).trim();
  try {
    run('read-tree', 'HEAD');
    run('add', '-A', '--', '.', ':(exclude,glob)**/node_modules/**');
    return run('write-tree');
  } finally {
    execFileSync('rm', ['-rf', scratch]);
  }
}

const commit = (message: string) =>
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', message);

function coarseStat(): void {
  git('config', 'core.checkStat', 'minimal');
  git('config', 'core.trustctime', 'false');
}

describe('the saved snapshot index', () => {
  it('gives the same tree as a fresh index through edits, adds, deletes and commits', async () => {
    await write('.gitignore', 'ignored/\n*.log\n');
    await write('src/a.ts', 'a\n');
    await write('src/b.ts', 'b\n');
    git('add', '.');
    commit('more');
    expect(await workingTree(root)).toBe(freshTree());
    await write('src/a.ts', 'changed\n');
    await write('src/new.ts', 'new\n');
    await write('ignored/secret.txt', 'no\n');
    await write('debug.log', 'no\n');
    await unlink(join(root, 'src/b.ts'));
    expect(await workingTree(root)).toBe(freshTree());
    git('add', 'src/new.ts');
    await write('src/new.ts', 'staged then edited\n');
    git('add', '-f', 'debug.log');
    expect(await workingTree(root)).toBe(freshTree());
    git('add', '-A');
    commit('landed');
    await write('src/after.ts', 'after\n');
    expect(await workingTree(root)).toBe(freshTree());
    git('checkout', '-q', 'HEAD~1', '--', '.');
    expect(await workingTree(root)).toBe(freshTree());
  });

  it('sees an edit that keeps the size and lands in the same second as a snapshot', async () => {
    coarseStat();
    const seen = new Set<string>();
    for (let round = 0; round < 12; round += 1) {
      const text = `v${round % 10}\n`;
      await write('app.ts', text);
      const tree = await workingTree(root);
      expect(tree).toBe(freshTree());
      expect(git('show', `${tree}:app.ts`)).toBe(text);
      seen.add(tree);
    }
    expect(seen.size).toBe(10);
  });

  it('reports a same-size edit made right after the run snapshot', async () => {
    coarseStat();
    await write('app.ts', 'aaa\n');
    const ref = await takeGitSnapshot(root, 'run-racy');
    await write('app.ts', 'bbb\n');
    expect(await gitChanges(root, ref)).toEqual([{ path: 'app.ts', change: 'modified' }]);
    await write('app.ts', 'aaa\n');
    expect(await gitChanges(root, ref)).toEqual([]);
  });

  it('sees a same-size edit made in the second of the last snapshot once that second has passed', async () => {
    coarseStat();
    const second = async () => Math.floor((await stat(join(root, 'app.ts'))).mtimeMs / 1000);
    let sameSecond = false;
    for (let attempt = 0; attempt < 5 && !sameSecond; attempt += 1) {
      await write('app.ts', 'one\n');
      const before = await second();
      expect(git('show', `${await workingTree(root)}:app.ts`)).toBe('one\n');
      await write('app.ts', 'two\n');
      sameSecond = (await second()) === before;
      await new Promise((resolve) => setTimeout(resolve, 1_100));
      expect(git('show', `${await workingTree(root)}:app.ts`)).toBe('two\n');
    }
    expect(sameSecond).toBe(true);
  });

  it('rebuilds from scratch when the saved index is damaged', async () => {
    await workingTree(root);
    const saved = join(root, '.git', SNAPSHOT_INDEX_NAME);
    await writeFile(saved, 'not an index');
    await write('app.ts', 'after damage\n');
    expect(await workingTree(root)).toBe(freshTree());
    await write('app.ts', 'and again\n');
    expect(await workingTree(root)).toBe(freshTree());
  });

  it('keeps a separate saved index for each linked worktree and leaves the real index alone', async () => {
    const copy = `${root}-copy`;
    git('worktree', 'add', '-q', '--detach', copy);
    try {
      await write('app.ts', 'main edit\n');
      await writeFile(join(copy, 'app.ts'), 'copy edit\n');
      await writeFile(join(copy, 'only-copy.ts'), 'copy\n');
      const status = git('status', '--porcelain');
      expect(await workingTree(root)).toBe(freshTree());
      expect(await workingTree(copy)).toBe(freshTree(copy));
      expect(await workingTree(root)).toBe(freshTree());
      expect(await workingTree(copy)).toBe(freshTree(copy));
      expect(git('status', '--porcelain')).toBe(status);
      expect(git('diff', '--cached', '--name-only')).toBe('');
    } finally {
      await rm(copy, { recursive: true, force: true });
    }
  });

  it('snapshots only the folder it is given inside a larger repo', async () => {
    await write('pkg/inner.ts', 'inner\n');
    await write('outside.ts', 'outside\n');
    git('add', '.');
    commit('layout');
    const inner = join(root, 'pkg');
    await write('pkg/inner.ts', 'inner edit\n');
    await write('outside.ts', 'outside edit\n');
    expect(await workingTree(inner)).toBe(freshTree(inner));
    expect(await workingTree(root)).toBe(freshTree());
    expect(await workingTree(inner)).toBe(freshTree(inner));
  });
});
