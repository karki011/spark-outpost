import { access, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { CONFIG_FILES, TOOL_FILES, packageManager, type CheckCommand } from '../checks/detect.ts';
import { runCheck, type CheckRun } from '../checks/run-check.ts';
import {
  installCommand,
  installFailure,
  lockfileFingerprint,
  rememberDeps,
} from './deps-install.ts';

export type DepsMethod = 'clone' | 'copy' | 'offline_install' | 'install' | 'skipped';

export interface DepsPrep {
  method: DepsMethod;
  durationMs: number;
  note: string | null;
  folders: number;
  lockfileMatched: boolean | null;
  stale: boolean;
}

export type RunCommand = (argv: string[], cwd: string, network?: boolean) => Promise<CheckRun>;

export interface DepsOptions {
  platform?: NodeJS.Platform;
  root: string;
  signal?: AbortSignal;
  run?: RunCommand;
  onInstall?: (command: string) => void;
}

export const DEPS_PREP_LIMIT_MS = 90_000;
export const DEPS_INSTALL_LIMIT_MS = 300_000;
const SEARCH_DEPTH = 3;
const MAX_FOLDERS = 50;
const SKIPPED_DIRS = new Set(['node_modules', '.git', '.spark', 'dist', 'build', 'coverage']);

async function exists(target: string): Promise<boolean> {
  return access(target).then(
    () => true,
    () => false,
  );
}

export async function nodeModulesFolders(project: string): Promise<string[]> {
  const found: string[] = [];
  const visit = async (relative: string, depth: number): Promise<void> => {
    if (found.length >= MAX_FOLDERS) return;
    const entries = await readdir(path.join(project, relative), { withFileTypes: true }).catch(
      () => [],
    );
    if (entries.some((entry) => entry.name === 'node_modules' && entry.isDirectory())) {
      found.push(relative);
    }
    if (depth >= SEARCH_DEPTH) return;
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || SKIPPED_DIRS.has(entry.name)) {
        continue;
      }
      await visit(path.join(relative, entry.name), depth + 1);
    }
  };
  await visit('', 0);
  return found;
}

export function cloneCommand(platform: NodeJS.Platform, from: string, to: string): string[] | null {
  if (platform === 'darwin') return ['cp', '-cR', from, to];
  if (platform === 'linux') return ['cp', '-R', '--reflink=auto', from, to];
  return null;
}

export function offlineInstall(present: ReadonlySet<string>): string[] | null {
  const manager = packageManager(present);
  const hasLockfile = CONFIG_FILES.some((file) => file !== 'package.json' && present.has(file));
  if (!hasLockfile) return null;
  if (manager === 'pnpm') {
    return ['pnpm', 'install', '--offline', '--frozen-lockfile', '--ignore-scripts'];
  }
  if (manager === 'npm') {
    return ['npm', 'ci', '--offline', '--ignore-scripts', '--no-audit', '--no-fund'];
  }
  if (manager === 'yarn') {
    return ['yarn', 'install', '--offline', '--frozen-lockfile', '--ignore-scripts'];
  }
  return null;
}

function defaultRun(options: DepsOptions): RunCommand {
  return (argv, cwd, network = false) => {
    const check: CheckCommand = { kind: 'custom', command: argv.join(' '), argv };
    return runCheck(check, {
      root: options.root,
      cwd,
      timeoutMs: network ? DEPS_INSTALL_LIMIT_MS : DEPS_PREP_LIMIT_MS,
      registryEnv: network,
      ...(options.signal ? { signal: options.signal } : {}),
    });
  };
}

function succeeded(run: CheckRun): boolean {
  return run.exitCode === 0 && !run.timedOut && !run.cancelled;
}

function firstLine(run: CheckRun): string {
  if (run.timedOut) return 'timed out';
  const line = run.outputTail.trim().split('\n').at(-1)?.trim();
  return line ? line.slice(0, 200) : `exited ${run.exitCode ?? 'with an error'}`;
}

async function cloneFolders(
  main: string,
  copy: string,
  folders: readonly string[],
  platform: NodeJS.Platform,
  run: RunCommand,
): Promise<string | null> {
  const cloned: string[] = [];
  for (const folder of folders) {
    const target = path.join(copy, folder, 'node_modules');
    if (!(await exists(path.join(copy, folder))) || (await exists(target))) continue;
    const argv = cloneCommand(platform, path.join(main, folder, 'node_modules'), target);
    if (!argv) return 'no copy-on-write clone on this platform';
    const result = await run(argv, copy);
    if (!succeeded(result)) {
      await Promise.all(
        [...cloned, target].map((dir) => rm(dir, { recursive: true, force: true })),
      );
      return `clone failed: ${firstLine(result)}`;
    }
    cloned.push(target);
  }
  return null;
}

async function lockfiles(project: string): Promise<Set<string>> {
  const found = await Promise.all(
    [...CONFIG_FILES, ...TOOL_FILES].map(
      async (file) => [file, await exists(path.join(project, file))] as const,
    ),
  );
  return new Set(found.filter(([, present]) => present).map(([file]) => file));
}

export async function prepareDependencies(
  main: string,
  copy: string,
  options: DepsOptions,
): Promise<DepsPrep | null> {
  if (!(await exists(path.join(copy, 'package.json')))) return null;
  const started = Date.now();
  const platform = options.platform ?? process.platform;
  const run = options.run ?? defaultRun(options);
  const folders = await nodeModulesFolders(main);
  const [mainLock, copyLock] = await Promise.all([
    lockfileFingerprint(main),
    lockfileFingerprint(copy),
  ]);
  const lockfileMatched = mainLock && copyLock ? mainLock === copyLock : null;
  const done = (method: DepsMethod, note: string | null, stale = false): DepsPrep => {
    if (copyLock) rememberDeps(copy, copyLock, stale ? note : null);
    return {
      method,
      durationMs: Date.now() - started,
      note,
      folders: method === 'clone' || method === 'copy' ? folders.length : 0,
      lockfileMatched,
      stale,
    };
  };
  const present = await lockfiles(copy);
  const install = offlineInstall(present);
  const notes: string[] = [];
  const tryInstall = async (): Promise<boolean> => {
    if (!install) {
      notes.push('no lockfile for an offline install');
      return false;
    }
    const installed = await run(install, copy);
    if (!succeeded(installed)) notes.push(`${install.join(' ')}: ${firstLine(installed)}`);
    return succeeded(installed);
  };
  const tryClone = async (): Promise<boolean> => {
    if (folders.length === 0) {
      notes.push('the main copy has no node_modules');
      return false;
    }
    const failed = await cloneFolders(main, copy, folders, platform, run);
    if (failed) notes.push(failed);
    return failed === null;
  };
  const note = () => (notes.length > 0 ? notes.join('; ') : null);
  const cloned = platform === 'darwin' ? 'clone' : 'copy';
  const manager = packageManager(present, await readFile(path.join(copy, 'package.json'), 'utf8'));
  if (lockfileMatched === false) {
    if (manager === 'pnpm' && (await tryInstall())) return done('offline_install', note());
    const seeded = manager !== 'npm' && (await tryClone());
    const command = installCommand(manager, present, true);
    options.onInstall?.(command.join(' '));
    const installed = await run(command, copy, true);
    if (succeeded(installed)) return done('install', null);
    return done(seeded ? cloned : 'skipped', installFailure(command, installed), true);
  }
  if (manager === 'pnpm' && install) {
    if (await tryInstall()) return done('offline_install', note());
    if (await tryClone()) return done(cloned, note());
    return done('skipped', note());
  }
  if (await tryClone()) return done(cloned, note());
  if (await tryInstall()) return done('offline_install', note());
  return done('skipped', note());
}
