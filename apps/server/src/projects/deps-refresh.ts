import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { LOCKFILE_NAMES, TOOL_FILES, packageManager, type CheckCommand } from '../checks/detect.ts';
import { runCheck } from '../checks/run-check.ts';
import {
  installCommand,
  installFailure,
  knownDeps,
  lockfileFingerprint,
  lockfileFingerprintAt,
  rememberDeps,
} from './deps-install.ts';
import { DEPS_INSTALL_LIMIT_MS, type RunCommand } from './worktree-deps.ts';

export interface DepsRefresh {
  command: string;
  durationMs: number;
  installed: boolean;
}

export interface DepsState {
  refresh: DepsRefresh | null;
  stale: string | null;
}

export interface RefreshOptions {
  root: string;
  before: string | null;
  signal?: AbortSignal;
  run?: RunCommand;
}

const CURRENT: DepsState = { refresh: null, stale: null };

async function presentFiles(cwd: string): Promise<Set<string>> {
  const names = [...LOCKFILE_NAMES, ...TOOL_FILES];
  const found = await Promise.all(
    names.map((name) =>
      access(path.join(cwd, name)).then(
        () => name,
        () => null,
      ),
    ),
  );
  return new Set(found.filter((name): name is string => name !== null));
}

function defaultRun(options: RefreshOptions): RunCommand {
  return (argv, cwd) => {
    const check: CheckCommand = { kind: 'custom', command: argv.join(' '), argv };
    return runCheck(check, {
      root: options.root,
      cwd,
      timeoutMs: DEPS_INSTALL_LIMIT_MS,
      registryEnv: true,
      ...(options.signal ? { signal: options.signal } : {}),
    });
  };
}

export async function refreshDependencies(
  cwd: string,
  options: RefreshOptions,
): Promise<DepsState | null> {
  const current = await lockfileFingerprint(cwd);
  if (!current) return CURRENT;
  const known = knownDeps(cwd);
  if (known?.lockfile === current) return { refresh: null, stale: known.stale };
  const before = options.before ? await lockfileFingerprintAt(cwd, options.before) : null;
  const reference = known?.lockfile ?? before ?? current;
  if (reference === current) {
    rememberDeps(cwd, current, null);
    return CURRENT;
  }
  const manifest = await readFile(path.join(cwd, 'package.json'), 'utf8').catch(() => null);
  const present = await presentFiles(cwd);
  const argv = installCommand(packageManager(present, manifest), present, false);
  const run = await (options.run ?? defaultRun(options))(argv, cwd, true);
  if (run.cancelled) return null;
  const installed = run.exitCode === 0 && !run.timedOut;
  const stale = installed ? null : installFailure(argv, run);
  rememberDeps(cwd, current, stale);
  return {
    refresh: { command: argv.join(' '), durationMs: run.durationMs, installed },
    stale,
  };
}
