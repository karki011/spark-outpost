import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { LOCKFILE_NAMES, declaredManager, type PackageManager } from '../checks/detect.ts';
import { environmentProblem } from '../checks/failures.ts';
import type { CheckRun } from '../checks/run-check.ts';
import { gitFileAt } from './snapshot.ts';

type ReadFile = (name: string) => Promise<Buffer | null>;

async function fingerprint(read: ReadFile): Promise<string | null> {
  const hash = createHash('sha256');
  let found = false;
  for (const name of LOCKFILE_NAMES) {
    const content = await read(name);
    if (!content) continue;
    found = true;
    hash.update(name).update(content);
  }
  if (!found) return null;
  const manifest = await read('package.json');
  hash.update(declaredManager(manifest?.toString('utf8') ?? null) ?? '');
  return hash.digest('hex');
}

export function lockfileFingerprint(dir: string): Promise<string | null> {
  return fingerprint((name) => readFile(path.join(dir, name)).catch(() => null));
}

export function lockfileFingerprintAt(dir: string, tree: string): Promise<string | null> {
  return fingerprint((name) => gitFileAt(dir, tree, `./${name}`));
}

export function installCommand(
  manager: PackageManager,
  present: ReadonlySet<string>,
  scripts: boolean,
): string[] {
  const quiet = scripts ? [] : ['--ignore-scripts'];
  if (manager === 'pnpm')
    return ['pnpm', 'install', '--frozen-lockfile', '--prefer-offline', ...quiet];
  if (manager === 'bun') return ['bun', 'install', '--frozen-lockfile', ...quiet];
  if (manager === 'npm')
    return ['npm', 'ci', '--prefer-offline', '--no-audit', '--no-fund', ...quiet];
  if (present.has('.yarnrc.yml')) {
    return ['yarn', 'install', '--immutable', ...(scripts ? [] : ['--mode=skip-build'])];
  }
  return ['yarn', 'install', '--frozen-lockfile', '--prefer-offline', ...quiet];
}

function lastLine(run: CheckRun): string {
  if (run.timedOut) return 'it did not finish in time';
  const line = run.outputTail.trim().split('\n').at(-1)?.trim();
  return line ? line.slice(0, 200) : `it exited ${run.exitCode ?? 'with an error'}`;
}

function reason(argv: readonly string[], run: CheckRun): string {
  const problem = run.timedOut ? null : environmentProblem({ argv, ...run });
  if (problem === 'registry_login') {
    return 'your package registry login is missing or has expired; run `npm login` (or your registry’s sign-in)';
  }
  if (problem === 'offline') return 'the package registry could not be reached';
  if (problem === 'command_missing') return `\`${argv[0]}\` was not found on this computer`;
  return lastLine(run);
}

export function installFailure(argv: readonly string[], run: CheckRun): string {
  return `Dependencies in this chat’s copy are out of date and installing them failed: ${reason(argv, run)}. Checks that need them are reported as not run.`;
}

interface KnownDeps {
  lockfile: string;
  stale: string | null;
}

const known = new Map<string, KnownDeps>();

export function rememberDeps(cwd: string, lockfile: string, stale: string | null): void {
  known.set(cwd, { lockfile, stale });
}

export function knownDeps(cwd: string): KnownDeps | null {
  return known.get(cwd) ?? null;
}
