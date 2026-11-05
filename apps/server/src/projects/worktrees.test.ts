import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addWorktree,
  applyTree,
  branchName,
  commitWorktree,
  excludeSparkDir,
  groupBase,
  removeWorktree,
  takeFileFrom,
  tryMerge,
  worktreePath,
} from './worktrees.ts';

let root: string;
const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'spark-worktrees-')));
  await writeFile(join(root, 'format.ts'), 'one\ntwo\nthree\n');
  git('init', '-q');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '.');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'base');
  await writeFile(join(root, 'draft.ts'), 'uncommitted\n');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function copy(
  runId: string,
  name: string,
  base: string,
  edit: (dir: string) => Promise<void>,
) {
  const target = worktreePath(root, runId);
  const branch = branchName('abcdef1234', name);
  await addWorktree(root, target, branch, base);
  await edit(target);
  return { target, branch, result: await commitWorktree(root, target, branch, base, runId) };
}

const GIT_TIMEOUT_MS = 30_000;

describe('parallel copies', () => {
  it(
    'starts each copy from the working tree, including uncommitted files',
    async () => {
      await excludeSparkDir(root);
      const base = await groupBase(root, 'test');
      const bolt = await copy('r1', 'Bolt', base, async () => undefined);
      expect(await readFile(join(bolt.target, 'draft.ts'), 'utf8')).toBe('uncommitted\n');
      expect(bolt.branch).toBe('spark/abcdef12/bolt');
      expect(git('status', '--porcelain')).toBe('?? draft.ts\n');
      expect(await readFile(join(root, '.git/info/exclude'), 'utf8')).toContain('.spark/\n');
      await excludeSparkDir(root);
      const lines = (await readFile(join(root, '.git/info/exclude'), 'utf8')).split('\n');
      expect(lines.filter((line) => line === '.spark/')).toHaveLength(1);
    },
    GIT_TIMEOUT_MS,
  );

  it(
    'merges disjoint edits in order without touching the index',
    async () => {
      await excludeSparkDir(root);
      const base = await groupBase(root, 'test');
      const bolt = await copy('r1', 'Bolt', base, (dir) =>
        writeFile(join(dir, 'format.ts'), 'ONE\ntwo\nthree\n'),
      );
      const rivet = await copy('r2', 'Rivet', base, (dir) =>
        writeFile(join(dir, 'parse.ts'), 'new\n'),
      );
      for (const result of [bolt.result, rivet.result]) {
        const attempt = await tryMerge(root, base, result);
        expect(attempt.conflicts).toEqual([]);
        await applyTree(root, attempt.current, attempt.tree);
      }
      expect(await readFile(join(root, 'format.ts'), 'utf8')).toBe('ONE\ntwo\nthree\n');
      expect(await readFile(join(root, 'parse.ts'), 'utf8')).toBe('new\n');
      expect(git('diff', '--cached', '--name-only')).toBe('');
      await removeWorktree(root, bolt.target, bolt.branch);
      await removeWorktree(root, rivet.target, rivet.branch);
      expect(git('branch', '--list', 'spark/*')).toBe('');
      expect(git('worktree', 'list')).not.toContain('.spark');
    },
    GIT_TIMEOUT_MS,
  );

  it(
    'reports a conflict when two copies change the same line, and can keep either',
    async () => {
      await excludeSparkDir(root);
      const base = await groupBase(root, 'test');
      const bolt = await copy('r1', 'Bolt', base, (dir) =>
        writeFile(join(dir, 'format.ts'), 'one\nBOLT\nthree\n'),
      );
      const rivet = await copy('r2', 'Rivet', base, (dir) =>
        writeFile(join(dir, 'format.ts'), 'one\nRIVET\nthree\n'),
      );
      const first = await tryMerge(root, base, bolt.result);
      await applyTree(root, first.current, first.tree);
      const second = await tryMerge(root, base, rivet.result);
      expect(second.conflicts).toEqual(['format.ts']);
      await applyTree(root, second.current, second.tree, second.conflicts);
      expect(await readFile(join(root, 'format.ts'), 'utf8')).toBe('one\nBOLT\nthree\n');
      await takeFileFrom(root, rivet.result, 'format.ts');
      expect(await readFile(join(root, 'format.ts'), 'utf8')).toBe('one\nRIVET\nthree\n');
    },
    GIT_TIMEOUT_MS,
  );
});
