import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CheckRun } from '../checks/run-check.ts';
import {
  cloneCommand,
  nodeModulesFolders,
  offlineInstall,
  prepareDependencies,
  type RunCommand,
} from './worktree-deps.ts';

let main: string;
let copy: string;

const ok: CheckRun = {
  exitCode: 0,
  timedOut: false,
  cancelled: false,
  durationMs: 1,
  outputTail: '',
  truncated: false,
};

async function put(file: string, text = 'x') {
  await mkdir(join(file, '..'), { recursive: true });
  await writeFile(file, text);
}

beforeEach(async () => {
  main = await realpath(await mkdtemp(join(tmpdir(), 'spark-deps-')));
  copy = join(main, '.spark', 'worktrees', 'run-1');
  for (const root of [main, copy]) {
    await put(join(root, 'package.json'), '{"name":"app"}');
    await put(join(root, 'packages', 'lib', 'package.json'), '{"name":"lib"}');
  }
  await put(join(main, 'node_modules', 'left-pad', 'index.js'), 'module.exports = 1;');
  await put(join(main, 'packages', 'lib', 'node_modules', 'tiny', 'index.js'), 'ok');
});

afterEach(async () => {
  await rm(main, { recursive: true, force: true });
});

describe('preparing dependencies in a worktree', () => {
  it('finds node_modules folders without walking into them or hidden folders', async () => {
    expect((await nodeModulesFolders(main)).sort()).toEqual(['', join('packages', 'lib')]);
  });

  it('clones node_modules as real folders, never symlinks', async () => {
    const prep = await prepareDependencies(main, copy, { root: main });
    expect(prep).toMatchObject({ note: null, folders: 2 });
    expect(['clone', 'copy']).toContain(prep?.method);
    const cloned = join(copy, 'node_modules', 'left-pad', 'index.js');
    expect(await readFile(cloned, 'utf8')).toBe('module.exports = 1;');
    expect((await lstat(join(copy, 'node_modules'))).isSymbolicLink()).toBe(false);
    await writeFile(cloned, 'changed in the copy');
    expect(await readFile(join(main, 'node_modules', 'left-pad', 'index.js'), 'utf8')).toBe(
      'module.exports = 1;',
    );
  });

  it('installs offline first for pnpm, whose store makes it faster than a clone', async () => {
    await put(join(copy, 'pnpm-lock.yaml'), 'lockfileVersion: 9');
    const calls: string[][] = [];
    const run: RunCommand = async (argv) => {
      calls.push(argv);
      return ok;
    };
    const prep = await prepareDependencies(main, copy, { root: main, platform: 'darwin', run });
    expect(prep).toMatchObject({ method: 'offline_install', note: null });
    expect(calls).toEqual([
      ['pnpm', 'install', '--offline', '--frozen-lockfile', '--ignore-scripts'],
    ]);
  });

  it('lands a clone through the staging folder, so an interrupted one never looks finished', async () => {
    const staging = join(main, '.staging');
    await mkdir(staging, { recursive: true });
    const landings: string[] = [];
    const run: RunCommand = async (argv) => {
      landings.push(argv.at(-1)!);
      if (landings.length === 2) return { ...ok, cancelled: true };
      await mkdir(argv.at(-1)!, { recursive: true });
      return ok;
    };
    await prepareDependencies(main, copy, { root: main, platform: 'darwin', run, staging });
    expect(landings.slice(0, 2)).toEqual([join(staging, '0'), join(staging, '1')]);
    await expect(lstat(join(copy, 'node_modules'))).rejects.toThrow();
    await expect(lstat(join(staging, '0'))).rejects.toThrow();
    const again = await prepareDependencies(main, copy, { root: main, staging });
    expect(again).toMatchObject({ note: null, folders: 2 });
    expect(await readFile(join(copy, 'node_modules', 'left-pad', 'index.js'), 'utf8')).toBe(
      'module.exports = 1;',
    );
    expect(
      await readFile(join(copy, 'packages', 'lib', 'node_modules', 'tiny', 'index.js'), 'utf8'),
    ).toBe('ok');
  });

  it('reports copying and installing as each begins', async () => {
    await put(join(copy, 'package-lock.json'), '{}');
    const phases: string[] = [];
    const run: RunCommand = async (argv) => (argv[0] === 'cp' ? { ...ok, exitCode: 1 } : ok);
    await prepareDependencies(main, copy, {
      root: main,
      platform: 'darwin',
      run,
      onPhase: (phase) => phases.push(phase),
    });
    expect(phases).toEqual(['copy', 'install']);
  });

  it('clones first for npm and falls back to an offline install', async () => {
    await put(join(copy, 'package-lock.json'), '{}');
    const calls: string[][] = [];
    const run: RunCommand = async (argv) => {
      calls.push(argv);
      return argv[0] === 'cp' ? { ...ok, exitCode: 1, outputTail: 'clonefile failed' } : ok;
    };
    const prep = await prepareDependencies(main, copy, { root: main, platform: 'darwin', run });
    expect(prep).toMatchObject({
      method: 'offline_install',
      note: 'clone failed: clonefile failed',
    });
    expect(calls.map((argv) => argv[0])).toEqual(['cp', 'npm']);
  });

  it('skips with a note when nothing works, and ignores projects without package.json', async () => {
    const failing: RunCommand = async () => ({ ...ok, exitCode: 1, outputTail: 'no' });
    const prep = await prepareDependencies(main, copy, {
      root: main,
      platform: 'win32',
      run: failing,
    });
    expect(prep).toMatchObject({
      method: 'skipped',
      note: 'no copy-on-write clone on this platform; no lockfile for an offline install',
    });
    await rm(join(copy, 'package.json'));
    expect(await prepareDependencies(main, copy, { root: main })).toBeNull();
  });

  it('builds the clone and install commands per platform and lockfile', () => {
    expect(cloneCommand('darwin', 'a', 'b')).toEqual(['cp', '-cR', 'a', 'b']);
    expect(cloneCommand('linux', 'a', 'b')).toEqual(['cp', '-R', '--reflink=auto', 'a', 'b']);
    expect(offlineInstall(new Set(['package.json', 'package-lock.json']))?.slice(0, 3)).toEqual([
      'npm',
      'ci',
      '--offline',
    ]);
    expect(offlineInstall(new Set(['package.json']))).toBeNull();
  });
});
