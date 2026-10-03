import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { liveRunBase } from './run-base.ts';
import { gitChanges, revertGitChanges, takeGitSnapshot } from './snapshot.ts';

let scratch: string;
let upstream: string;
let clone: string;

const AUTHOR = ['-c', 'user.email=t@t', '-c', 'user.name=t'];

function git(root: string, ...args: string[]): string {
  return execFileSync('git', ['-C', root, ...AUTHOR, ...args], { encoding: 'utf8' }).trim();
}

async function write(root: string, relative: string, text: string): Promise<void> {
  const target = join(root, relative);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, text);
}

async function commitAll(root: string, message: string): Promise<void> {
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', message);
}

async function landUpstream(): Promise<void> {
  for (let index = 0; index < 40; index += 1) {
    await write(
      upstream,
      `tools/design-system-mcp/file-${index}.ts`,
      `export const n = ${index};\n`,
    );
  }
  await rm(join(upstream, '.archived'), { recursive: true, force: true });
  await write(upstream, 'vitest.config.ts', 'export default { upstream: true };\n');
  await commitAll(upstream, 'newer main');
}

async function changedPaths(ref: string): Promise<string[]> {
  const base = await liveRunBase(clone, ref);
  return (await gitChanges(clone, base)).map((change) => `${change.change} ${change.path}`).sort();
}

beforeEach(async () => {
  scratch = await realpath(await mkdtemp(join(tmpdir(), 'spark-run-base-')));
  upstream = join(scratch, 'upstream');
  clone = join(scratch, 'clone');
  await mkdir(upstream);
  git(upstream, 'init', '-q', '-b', 'main');
  await write(upstream, 'app.ts', 'one\n');
  await write(upstream, '.archived/Makefile', 'all:\n');
  await write(upstream, 'vitest.config.ts', 'export default {};\n');
  await commitAll(upstream, 'base');
  execFileSync('git', ['clone', '-q', upstream, clone]);
  git(clone, 'checkout', '-q', '-b', 'spark/chat');
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe(
  'a run’s own changes when the agent updates the branch from its base',
  { timeout: 30_000 },
  () => {
    it('leaves out upstream changes brought in by a fetch and fast-forward', async () => {
      const ref = await takeGitSnapshot(clone, 'run-ff');
      await landUpstream();
      git(clone, 'fetch', '-q', 'origin');
      git(clone, 'merge', '-q', '--ff-only', 'origin/main');
      await write(clone, 'app.ts', 'two\n');
      expect(await changedPaths(ref)).toEqual(['modified app.ts']);
    });

    it('leaves out upstream changes when the agent rebases its own commit onto newer main', async () => {
      const ref = await takeGitSnapshot(clone, 'run-rebase');
      await write(clone, 'feature.ts', 'export const feature = 1;\n');
      await commitAll(clone, 'agent work');
      await landUpstream();
      git(clone, 'fetch', '-q', 'origin');
      git(clone, 'rebase', '-q', 'origin/main');
      await write(clone, 'app.ts', 'two\n');
      expect(await changedPaths(ref)).toEqual(['added feature.ts', 'modified app.ts']);
    });

    it('keeps work that was uncommitted before the run out of the count after a fast-forward', async () => {
      await write(clone, 'notes.md', 'mine\n');
      const ref = await takeGitSnapshot(clone, 'run-dirty');
      await landUpstream();
      git(clone, 'fetch', '-q', 'origin');
      git(clone, 'merge', '-q', '--ff-only', 'origin/main');
      await write(clone, 'app.ts', 'two\n');
      expect(await changedPaths(ref)).toEqual(['modified app.ts']);
    });

    it('still counts the agent’s own commits after its branch is pushed', async () => {
      const ref = await takeGitSnapshot(clone, 'run-pushed');
      await write(clone, 'feature.ts', 'export const feature = 1;\n');
      await commitAll(clone, 'agent work');
      git(clone, 'push', '-q', 'origin', 'spark/chat');
      git(clone, 'fetch', '-q', 'origin');
      expect(await changedPaths(ref)).toEqual(['added feature.ts']);
    });

    it('counts everything against the snapshot when the branch did not move', async () => {
      const ref = await takeGitSnapshot(clone, 'run-still');
      await write(clone, 'app.ts', 'two\n');
      await rm(join(clone, '.archived'), { recursive: true });
      expect(await changedPaths(ref)).toEqual(['deleted .archived/Makefile', 'modified app.ts']);
    });

    it('reverts only the agent’s edit and keeps the newer main', async () => {
      const ref = await takeGitSnapshot(clone, 'run-revert');
      await landUpstream();
      git(clone, 'fetch', '-q', 'origin');
      git(clone, 'merge', '-q', '--ff-only', 'origin/main');
      await write(clone, 'vitest.config.ts', 'export default { agent: true };\n');
      const base = await liveRunBase(clone, ref);
      await revertGitChanges(clone, base, await gitChanges(clone, base));
      expect(await readFile(join(clone, 'vitest.config.ts'), 'utf8')).toBe(
        'export default { upstream: true };\n',
      );
      expect(git(clone, 'status', '--porcelain')).toBe('');
    });
  },
);
