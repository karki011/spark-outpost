import { execFileSync } from 'node:child_process';
import { mkdtemp, realpath, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { attributeFiles, laneSnapshots } from './shared-tree.ts';
import { commitWorkingTree, gitChanges } from './snapshot.ts';

let root: string;
const git = (...args: string[]) =>
  execFileSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
    encoding: 'utf8',
  });

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'spark-shared-')));
  await writeFile(join(root, 'a.ts'), 'a\n');
  await writeFile(join(root, 'b.ts'), 'b\n');
  await writeFile(join(root, 'old.ts'), 'old\n');
  git('init', '-q');
  git('add', '.');
  git('commit', '-qm', 'base');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('attributing a shared working tree to lanes', () => {
  it('gives each lane its declared files and the rest to the last lane', () => {
    const attribution = attributeFiles(
      ['src/a.ts', 'b.ts', 'README.md'],
      [
        { key: 'bolt', declared: ['src/a.ts'] },
        { key: 'rivet', declared: ['b.ts'] },
      ],
    );
    expect(attribution.files).toEqual(
      new Map([
        ['bolt', ['src/a.ts']],
        ['rivet', ['b.ts', 'README.md']],
      ]),
    );
    expect(attribution.unclaimed).toEqual(['README.md']);
  });

  it('builds per-lane snapshots so each lane’s diff holds only its files', async () => {
    const base = git('rev-parse', 'HEAD').trim();
    await writeFile(join(root, 'a.ts'), 'a changed by bolt\n');
    await unlink(join(root, 'old.ts'));
    await writeFile(join(root, 'b.ts'), 'b changed by rivet\n');
    const source = await commitWorkingTree(root, [base], 'after');
    const files = new Map([
      ['bolt', ['a.ts', 'old.ts']],
      ['rivet', ['b.ts']],
    ]);
    const [bolt, rivet] = await laneSnapshots(root, base, source, ['bolt', 'rivet'], files);
    expect(bolt!.commit).toBe(base);
    const boltDiff = await gitChanges(root, bolt!.commit, rivet!.commit);
    expect(boltDiff).toEqual([
      { path: 'a.ts', change: 'modified' },
      { path: 'old.ts', change: 'deleted' },
    ]);
    expect(await gitChanges(root, rivet!.commit, source)).toEqual([
      { path: 'b.ts', change: 'modified' },
    ]);
  });
});
