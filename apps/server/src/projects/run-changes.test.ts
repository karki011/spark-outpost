import { execFileSync } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { changesWhilePresent } from './run-changes.ts';
import { gitChanges, takeGitSnapshot } from './snapshot.ts';

async function repo(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'spark-run-changes-')));
  await writeFile(join(root, 'a.txt'), 'a\n');
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args]);
  git('init', '-q');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '.');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'base');
  return root;
}

describe('reading a run’s changes while its folder may vanish', () => {
  it('gives nothing, quietly, when the folder was removed while git ran', async () => {
    const root = await repo();
    const ref = await takeGitSnapshot(root, 'run-1');
    await rm(root, { recursive: true, force: true });
    await expect(changesWhilePresent(root, () => gitChanges(root, ref))).resolves.toBeNull();
  });

  it('gives nothing when the folder is still there but no longer a repository', async () => {
    const root = await repo();
    try {
      const ref = await takeGitSnapshot(root, 'run-3');
      await rm(join(root, '.git'), { recursive: true, force: true });
      await expect(changesWhilePresent(root, () => gitChanges(root, ref))).resolves.toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('still reports a git failure while the folder is there', async () => {
    const root = await repo();
    try {
      await expect(
        changesWhilePresent(root, () => gitChanges(root, 'no-such-ref')),
      ).rejects.toThrow();
      await writeFile(join(root, 'b.txt'), 'b\n');
      const ref = await takeGitSnapshot(root, 'run-2');
      await expect(changesWhilePresent(root, () => gitChanges(root, ref))).resolves.toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
