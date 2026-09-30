import { execFileSync } from 'node:child_process';
import { mkdtemp, realpath, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { attributeFiles, runSnapshots } from './shared-tree.ts';
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

const owner = (key: string, files: string[]) => ({
  key,
  owns: (file: string) => files.includes(file),
});

describe('attributing a shared working tree to pieces', () => {
  it('gives each piece its owned files and the rest to the piece named last', () => {
    const attribution = attributeFiles(
      ['src/a.ts', 'b.ts', 'README.md'],
      [owner('P1', ['src/a.ts']), owner('P2', ['b.ts'])],
      'P2',
    );
    expect(attribution.files).toEqual(
      new Map([
        ['P1', ['src/a.ts']],
        ['P2', ['b.ts', 'README.md']],
      ]),
    );
    expect(attribution.unclaimed).toEqual(['README.md']);
  });

  it('builds per-run snapshots so each run’s diff holds only its files', async () => {
    const base = git('rev-parse', 'HEAD').trim();
    await writeFile(join(root, 'a.ts'), 'a changed by bolt\n');
    await unlink(join(root, 'old.ts'));
    await writeFile(join(root, 'b.ts'), 'b changed by rivet\n');
    const source = await commitWorkingTree(root, [base], 'after');
    const files = new Map([
      ['bolt', ['a.ts', 'old.ts']],
      ['rivet', ['b.ts']],
    ]);
    const [bolt, rivet] = await runSnapshots(root, base, source, ['bolt', 'rivet'], files);
    expect(bolt!.commit).toBe(base);
    expect(await gitChanges(root, bolt!.commit, rivet!.commit)).toEqual([
      { path: 'a.ts', change: 'modified' },
      { path: 'old.ts', change: 'deleted' },
    ]);
    expect(await gitChanges(root, rivet!.commit, source)).toEqual([
      { path: 'b.ts', change: 'modified' },
    ]);
  });
});
