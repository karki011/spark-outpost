import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { parseNumstat, type DiffStat } from '../../bench/verify.ts';
import type { Patch, RepoKey } from './session-types.ts';
import { SPARK_BASELINE, SPARK_HIDDEN_PATHS } from './sessions.ts';

const run = promisify(execFile);
export const ROOT = resolve(import.meta.dirname, '../../..');
export const FIXTURES = join(import.meta.dirname, 'fixtures');

const EXTERNAL_REPO =
  process.env.DEV_DAY_EXTERNAL_REPO ??
  '/private/tmp/claude-501/-Users-hmk-Downloads-spark-outpost/de4f337c-37ca-43f6-b4b8-456b09d97ef9/scratchpad/repos/feature-web-apps';

export const FAKE_REMOTE_HOST = 'github.e2e.localhost';
const FAKE_REMOTE_URL = `https://${FAKE_REMOTE_HOST}/e2e-bench/workbench.git`;

export function git(repo: string, ...args: string[]): string {
  return execFileSync(
    'git',
    ['-C', repo, '-c', 'user.email=dev-day@spark.local', '-c', 'user.name=Dev Day', ...args],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
}

export interface DayRepo {
  key: RepoKey;
  path: string;
  remote: string | null;
  original: { path: string; fingerprint: string } | null;
  install: { ms: number; error: string | null } | null;
}

function assertInside(path: string, root: string): void {
  if (!resolve(path).startsWith(`${resolve(root)}${sep}`)) {
    throw new Error(`Refusing to touch ${path}: it is not inside ${root}.`);
  }
}

async function applyEdit(repo: string, file: string, from: string, to: string): Promise<void> {
  const path = join(repo, file);
  const text = await readFile(path, 'utf8');
  if (!text.includes(from))
    throw new Error(`Cannot patch ${file}: "${from.slice(0, 60)}" is gone.`);
  await writeFile(path, text.replace(from, to));
}

export async function applyPatch(repo: string, patch: Patch): Promise<void> {
  for (const [target, source] of Object.entries(patch.files ?? {})) {
    await mkdir(dirname(join(repo, target)), { recursive: true });
    await cp(join(FIXTURES, source), join(repo, target));
  }
  for (const edit of patch.edits ?? []) await applyEdit(repo, edit.file, edit.from, edit.to);
}

async function install(repo: string): Promise<DayRepo['install']> {
  const started = Date.now();
  const error = await run(
    'pnpm',
    ['install', '--offline', '--frozen-lockfile', '--ignore-scripts'],
    {
      cwd: repo,
      timeout: 300_000,
    },
  ).then(
    () => null,
    (failure: Error) => failure.message.split('\n')[0] ?? 'pnpm install failed',
  );
  return { ms: Date.now() - started, error };
}

async function createSparkRepo(dir: string, name: string): Promise<DayRepo> {
  const path = join(dir, 'repos', name);
  assertInside(path, dir);
  await rm(path, { recursive: true, force: true });
  await mkdir(path, { recursive: true });
  execFileSync('sh', ['-c', `git -C "${ROOT}" archive --format=tar HEAD | tar -x -C "${path}"`]);
  for (const hidden of SPARK_HIDDEN_PATHS)
    await rm(join(path, hidden), { recursive: true, force: true });
  git(path, 'init', '-q', '-b', 'main');
  git(path, 'add', '-A');
  git(path, 'commit', '-qm', 'Spark Outpost (copy for the dev-day benchmark)');
  await applyPatch(path, SPARK_BASELINE);
  git(path, 'commit', '-qam', 'Analytics copy tweaks');
  const installed = await install(path);
  return { key: 'spark', path, remote: null, original: null, install: installed };
}

async function createWorkbenchRepo(dir: string, name: string): Promise<DayRepo> {
  const path = join(dir, 'repos', name);
  const remote = join(dir, 'repos', `${name}-remote.git`);
  assertInside(path, dir);
  await rm(path, { recursive: true, force: true });
  await rm(remote, { recursive: true, force: true });
  await cp(join(FIXTURES, 'workbench'), path, { recursive: true });
  git(path, 'init', '-q', '-b', 'main');
  git(path, 'add', '-A');
  git(path, 'commit', '-qm', 'Workbench');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
  git(path, 'remote', 'add', 'origin', FAKE_REMOTE_URL);
  git(path, 'config', `url.file://${remote}.insteadOf`, FAKE_REMOTE_URL);
  git(path, 'config', 'url.file:///nonexistent/dev-day-blocked/.insteadOf', 'https://');
  git(path, 'push', '-q', 'origin', 'main');
  git(path, 'fetch', '-q', 'origin');
  git(path, 'remote', 'set-head', 'origin', 'main');
  git(path, 'branch', '-q', '--set-upstream-to=origin/main', 'main');
  return { key: 'workbench', path, remote, original: null, install: null };
}

export function fingerprint(repo: string): string {
  const head = git(repo, 'rev-parse', 'HEAD').trim();
  const status = git(repo, 'status', '--porcelain', '--ignored=no');
  const refs = git(repo, 'for-each-ref', '--format=%(refname) %(objectname)');
  return createHash('sha256').update(`${head}\n${status}\n${refs}`).digest('hex');
}

async function createExternalRepo(dir: string, name: string): Promise<DayRepo> {
  const path = join(dir, 'repos', name);
  assertInside(path, dir);
  await rm(path, { recursive: true, force: true });
  const before = fingerprint(EXTERNAL_REPO);
  execFileSync('git', ['clone', '-q', '--local', '--no-hardlinks', EXTERNAL_REPO, path]);
  git(path, 'remote', 'remove', 'origin');
  return {
    key: 'external',
    path,
    remote: null,
    original: { path: EXTERNAL_REPO, fingerprint: before },
    install: null,
  };
}

export async function createRepo(key: RepoKey, dir: string, name: string): Promise<DayRepo> {
  if (key === 'spark') return createSparkRepo(dir, name);
  if (key === 'workbench') return createWorkbenchRepo(dir, name);
  return createExternalRepo(dir, name);
}

const IGNORED_CHANGES =
  /^(?:\.spark\/|node_modules\/|bench-verify\/|apps\/web\/src\/__devday_hidden__\/)/;

export interface Snapshot {
  head: string;
  branch: string;
  files: Map<string, string>;
}

export function snapshot(repo: string): Snapshot {
  const status = git(repo, 'status', '--porcelain', '-z', '-uall');
  const files = new Map<string, string>();
  const entries = status.split('\0').filter(Boolean);
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    const path = entry.slice(3);
    if (entry.startsWith('R') || entry.startsWith('C')) index += 1;
    if (IGNORED_CHANGES.test(path)) continue;
    const hash = execFileSync('git', ['-C', repo, 'hash-object', '--', path], {
      encoding: 'utf8',
    }).trim();
    files.set(path, hash);
  }
  const branch = git(repo, 'rev-parse', '--abbrev-ref', 'HEAD').trim();
  return { head: git(repo, 'rev-parse', 'HEAD').trim(), branch, files };
}

function blobAt(repo: string, commit: string, path: string): string {
  try {
    return execFileSync('git', ['-C', repo, 'rev-parse', '-q', '--verify', `${commit}:${path}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'missing';
  }
}

export function changedFiles(repo: string, before: Snapshot): string[] {
  const after = snapshot(repo);
  const changed = new Set<string>();
  if (after.head !== before.head) {
    for (const file of git(repo, 'diff', '--name-only', before.head, after.head).split('\n')) {
      if (file && !IGNORED_CHANGES.test(file)) changed.add(file);
    }
  }
  const paths = new Set([...before.files.keys(), ...after.files.keys()]);
  for (const path of paths) {
    const was = before.files.get(path) ?? blobAt(repo, before.head, path);
    const now = after.files.get(path) ?? blobAt(repo, after.head, path);
    if (was !== now) changed.add(path);
  }
  return [...changed].sort();
}

export function diffStat(repo: string, base: string): DiffStat {
  git(repo, 'add', '-A');
  const stat = parseNumstat(git(repo, 'diff', '--cached', '--numstat', base));
  const files = stat.files.filter((file) => !IGNORED_CHANGES.test(file));
  return { ...stat, files };
}

export function restore(repo: DayRepo, dir: string, base: string): void {
  assertInside(repo.path, dir);
  git(repo.path, 'checkout', '-q', '-f', 'main');
  git(repo.path, 'reset', '-q', '--hard', base);
  git(repo.path, 'clean', '-q', '-fd');
  git(repo.path, 'worktree', 'prune');
}

export async function settle(
  repo: DayRepo,
  dir: string,
  base: string,
  reference: Patch | undefined,
  label: string,
): Promise<void> {
  restore(repo, dir, base);
  if (!reference) return;
  await applyPatch(repo.path, reference);
  git(repo.path, 'add', '-A');
  git(repo.path, 'commit', '-qm', label);
}

export function remoteBranches(remote: string): string[] {
  return execFileSync(
    'git',
    ['-C', remote, 'for-each-ref', '--format=%(refname:short)', 'refs/heads'],
    {
      encoding: 'utf8',
    },
  )
    .split('\n')
    .filter(Boolean);
}
