import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CheckRun } from '../checks/run-check.ts';
import { installCommand, knownDeps } from './deps-install.ts';
import { refreshDependencies } from './deps-refresh.ts';
import { prepareDependencies, type RunCommand } from './worktree-deps.ts';

let main: string;
let copy: string;

const ok: CheckRun = {
  exitCode: 0,
  timedOut: false,
  cancelled: false,
  durationMs: 1,
  outputTail: '',
  truncated: false,
  failures: [],
};

const LOGIN_EXPIRED: CheckRun = {
  ...ok,
  exitCode: 1,
  outputTail: 'ERR_PNPM_FETCH_401  GET https://registry.example.test/x: Unauthorized - 401',
};

async function put(file: string, text = 'x') {
  await mkdir(join(file, '..'), { recursive: true });
  await writeFile(file, text);
}

function recorder(answer: (argv: string[], network: boolean) => CheckRun = () => ok) {
  const calls: { argv: string[]; network: boolean }[] = [];
  const run: RunCommand = async (argv, _cwd, network = false) => {
    calls.push({ argv, network });
    return answer(argv, network);
  };
  return { calls, run, commands: () => calls.map((call) => call.argv.join(' ')) };
}

const git = (...args: string[]) =>
  execFileSync('git', ['-C', main, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args])
    .toString()
    .trim();

beforeEach(async () => {
  main = await realpath(await mkdtemp(join(tmpdir(), 'spark-deps-install-')));
  copy = join(main, '.spark', 'worktrees', 'run-1');
  for (const root of [main, copy]) {
    await put(join(root, 'package.json'), '{"name":"app","packageManager":"pnpm@9.0.0"}');
    await put(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
  }
  await put(join(main, 'node_modules', 'left-pad', 'index.js'), 'module.exports = 1;');
});

afterEach(async () => {
  await rm(main, { recursive: true, force: true });
});

describe('dependencies for a copy whose lockfile differs from the checkout', () => {
  it('only prepares offline when the lockfiles match', async () => {
    const { run, commands } = recorder();
    const prep = await prepareDependencies(main, copy, { root: main, platform: 'darwin', run });
    expect(prep).toMatchObject({ method: 'offline_install', lockfileMatched: true, stale: false });
    expect(commands()).toEqual(['pnpm install --offline --frozen-lockfile --ignore-scripts']);
  });

  it('clones only, with no install, for a matching npm lockfile', async () => {
    for (const root of [main, copy]) {
      await rm(join(root, 'pnpm-lock.yaml'));
      await put(join(root, 'package.json'), '{"name":"app"}');
      await put(join(root, 'package-lock.json'), '{}');
    }
    const { run, calls } = recorder();
    const prep = await prepareDependencies(main, copy, { root: main, platform: 'darwin', run });
    expect(prep).toMatchObject({ method: 'clone', lockfileMatched: true });
    expect(calls.map((call) => call.argv[0])).toEqual(['cp']);
  });

  it('installs once from the registry when the offline store cannot satisfy a different lockfile', async () => {
    await put(join(copy, 'pnpm-lock.yaml'), 'lockfileVersion: 9\nnewer: true\n');
    const announced: string[] = [];
    const { run, calls } = recorder((argv) =>
      argv.includes('--offline')
        ? { ...ok, exitCode: 1, outputTail: 'ERR_PNPM_NO_OFFLINE_TARBALL' }
        : ok,
    );
    const prep = await prepareDependencies(main, copy, {
      root: main,
      platform: 'darwin',
      run,
      onInstall: (command) => announced.push(command),
    });
    expect(prep).toMatchObject({
      method: 'install',
      lockfileMatched: false,
      stale: false,
      note: null,
    });
    expect(calls.map((call) => [call.argv.slice(0, 2).join(' '), call.network])).toEqual([
      ['pnpm install', false],
      ['cp -cR', false],
      ['pnpm install', true],
    ]);
    expect(calls[2]!.argv).toEqual(['pnpm', 'install', '--frozen-lockfile', '--prefer-offline']);
    expect(announced).toEqual(['pnpm install --frozen-lockfile --prefer-offline']);
  });

  it('says in plain words why the install failed, keeps going, and marks the copy out of date', async () => {
    await put(join(copy, 'pnpm-lock.yaml'), 'lockfileVersion: 9\nnewer: true\n');
    const { run } = recorder((argv) => (argv[0] === 'pnpm' ? LOGIN_EXPIRED : ok));
    const prep = await prepareDependencies(main, copy, { root: main, platform: 'darwin', run });
    expect(prep).toMatchObject({ method: 'clone', lockfileMatched: false, stale: true });
    expect(prep?.note).toBe(
      'Dependencies in this chat’s copy are out of date and installing them failed: your package registry login is missing or has expired; run `npm login` (or your registry’s sign-in). Checks that need them are reported as not run.',
    );
    expect(knownDeps(copy)?.stale).toBe(prep?.note);
    const later = recorder();
    const state = await refreshDependencies(copy, { root: main, before: null, run: later.run });
    expect(state).toEqual({ refresh: null, stale: prep?.note });
    expect(later.calls).toEqual([]);
  });

  it('builds the reproducible install for each package manager', () => {
    const none = new Set<string>();
    expect(installCommand('npm', none, true)).toEqual([
      'npm',
      'ci',
      '--prefer-offline',
      '--no-audit',
      '--no-fund',
    ]);
    expect(installCommand('bun', none, true)).toEqual(['bun', 'install', '--frozen-lockfile']);
    expect(installCommand('yarn', new Set(['.yarnrc.yml']), true)).toEqual([
      'yarn',
      'install',
      '--immutable',
    ]);
    expect(installCommand('yarn', none, false)).toEqual([
      'yarn',
      'install',
      '--frozen-lockfile',
      '--prefer-offline',
      '--ignore-scripts',
    ]);
  });
});

describe('dependencies when the lockfile changes during a run', () => {
  beforeEach(() => {
    git('init', '-q');
    git('add', 'package.json', 'pnpm-lock.yaml');
    git('commit', '-qm', 'base');
  });

  it('installs once before checks, without scripts, and not again for the same lockfile', async () => {
    const before = git('rev-parse', 'HEAD^{tree}');
    const { run, commands } = recorder();
    expect(await refreshDependencies(main, { root: main, before, run })).toEqual({
      refresh: null,
      stale: null,
    });
    await put(join(main, 'pnpm-lock.yaml'), 'lockfileVersion: 9\nadded: left-pad\n');
    const state = await refreshDependencies(main, { root: main, before, run });
    expect(state).toMatchObject({ refresh: { installed: true }, stale: null });
    expect(await refreshDependencies(main, { root: main, before, run })).toEqual({
      refresh: null,
      stale: null,
    });
    expect(commands()).toEqual([
      'pnpm install --frozen-lockfile --prefer-offline --ignore-scripts',
    ]);
  });

  it('marks dependencies out of date once when that install fails', async () => {
    const fresh = join(main, 'sub');
    await put(join(fresh, 'package.json'), '{"name":"sub"}');
    await put(join(fresh, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
    git('add', 'sub');
    git('commit', '-qm', 'sub');
    const before = git('rev-parse', 'HEAD^{tree}');
    await put(join(fresh, 'pnpm-lock.yaml'), 'lockfileVersion: 9\nadded: left-pad\n');
    const { run, calls } = recorder(() => LOGIN_EXPIRED);
    const first = await refreshDependencies(fresh, { root: main, before, run });
    expect(first?.stale).toContain('installing them failed: your package registry login');
    const second = await refreshDependencies(fresh, { root: main, before, run });
    expect(second).toEqual({ refresh: null, stale: first?.stale });
    expect(calls).toHaveLength(1);
  });

  it('stops with the run', async () => {
    const fresh = join(main, 'other');
    await put(join(fresh, 'package.json'), '{"name":"other"}');
    await put(join(fresh, 'pnpm-lock.yaml'), 'one\n');
    git('add', 'other');
    git('commit', '-qm', 'other');
    const before = git('rev-parse', 'HEAD^{tree}');
    await put(join(fresh, 'pnpm-lock.yaml'), 'two\n');
    const run: RunCommand = async () => ({ ...ok, exitCode: null, cancelled: true });
    expect(await refreshDependencies(fresh, { root: main, before, run })).toBeNull();
    expect(knownDeps(fresh)).toBeNull();
  });
});
