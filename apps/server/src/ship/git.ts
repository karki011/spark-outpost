import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ShipFile } from '@spark-outpost/contracts';
import { redactText } from '../audit/redact.ts';
import { HARNESS_COMMIT_EMAIL } from '../projects/snapshot.ts';

const QUICK_MS = 15_000;
const SLOW_MS = 120_000;
const MAX_BUFFER = 16 * 1024 * 1024;

export class ShipGitError extends Error {}

interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runGit(
  root: string,
  args: string[],
  timeout = QUICK_MS,
  extraEnv: Record<string, string> = {},
): Promise<GitResult> {
  return new Promise((resolve) => {
    const child = execFile(
      'git',
      ['-C', root, ...args],
      {
        timeout,
        maxBuffer: MAX_BUFFER,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
          GIT_ASKPASS: '',
          SSH_ASKPASS: '',
          ...extraEnv,
        },
      },
      (error, stdout, stderr) => {
        const code = error ? (typeof error.code === 'number' ? error.code : -1) : 0;
        resolve({ code, stdout: String(stdout), stderr: String(stderr) });
      },
    );
    child.stdin?.end();
  });
}

function failure(action: string, result: GitResult): ShipGitError {
  const detail = redactText(`${result.stderr}\n${result.stdout}`.trim()).split('\n').slice(-6);
  return new ShipGitError(
    `${action} failed: ${detail.join(' ').trim() || `git exited ${result.code}`}`,
  );
}

async function gitOut(
  root: string,
  args: string[],
  action: string,
  timeout?: number,
  extraEnv?: Record<string, string>,
) {
  const result = await runGit(root, args, timeout, extraEnv);
  if (result.code !== 0) throw failure(action, result);
  return result.stdout;
}

async function gitMaybe(root: string, args: string[]): Promise<string | null> {
  const result = await runGit(root, args);
  return result.code === 0 ? result.stdout.trim() || null : null;
}

export async function gitInstalled(): Promise<boolean> {
  return (await runGit('.', ['--version'])).code === 0;
}

export interface RepoState {
  prefix: string;
  head: string | null;
  branch: string | null;
}

export async function repoState(root: string): Promise<RepoState | null> {
  const inside = await gitMaybe(root, ['rev-parse', '--is-inside-work-tree']);
  if (inside !== 'true') return null;
  return {
    prefix: (await gitMaybe(root, ['rev-parse', '--show-prefix'])) ?? '',
    head: await gitMaybe(root, ['rev-parse', '--verify', '-q', 'HEAD^{commit}']),
    branch: await gitMaybe(root, ['symbolic-ref', '--short', '-q', 'HEAD']),
  };
}

const NAME_STATUS: Record<string, ShipFile['change']> = { A: 'added', D: 'deleted' };

const topPathspec = (prefix: string, path: string) => `:(top,literal)${prefix}${path}`;

function statusChange(code: string): ShipFile['change'] {
  if (code === '??' || code.includes('A')) return 'added';
  if (code.includes('D')) return 'deleted';
  return 'modified';
}

export function parseNameStatus(output: string, prefix: string): ShipFile[] {
  const parts = output.split('\0').filter(Boolean);
  const files: ShipFile[] = [];
  for (let index = 0; index + 1 < parts.length; index += 2) {
    const file = parts[index + 1]!;
    if (!file.startsWith(prefix)) continue;
    const change = NAME_STATUS[parts[index]!.charAt(0)] ?? 'modified';
    files.push({ path: file.slice(prefix.length), change });
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

export function parseStatus(output: string, prefix: string): ShipFile[] {
  const files: ShipFile[] = [];
  for (const entry of output.split('\0')) {
    if (entry.length < 4) continue;
    const path = entry.slice(3);
    if (!path.startsWith(prefix)) continue;
    files.push({ path: path.slice(prefix.length), change: statusChange(entry.slice(0, 2)) });
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

export async function pendingFiles(
  root: string,
  prefix: string,
  paths: readonly string[],
): Promise<ShipFile[]> {
  if (paths.length === 0) return [];
  const output = await gitOut(
    root,
    [
      'status',
      '--porcelain=v1',
      '-z',
      '--untracked-files=all',
      '--no-renames',
      '--',
      ...paths.map((path) => topPathspec(prefix, path)),
    ],
    'Reading git status',
  );
  return parseStatus(output, prefix);
}

export async function branchExists(root: string, branch: string): Promise<boolean> {
  return (await gitMaybe(root, ['rev-parse', '--verify', '-q', `refs/heads/${branch}`])) !== null;
}

export async function createBranch(root: string, branch: string): Promise<void> {
  await gitOut(root, ['switch', '-c', branch], `Creating branch ${branch}`);
}

export async function commitFiles(
  root: string,
  prefix: string,
  files: readonly ShipFile[],
  subject: string,
  body: string,
): Promise<string> {
  const pathspecs = files.map((file) => topPathspec(prefix, file.path));
  await gitOut(root, ['add', '-A', '--', ...pathspecs], 'Staging the task files');
  await gitOut(
    root,
    ['commit', '--only', '-m', subject, '-m', body, '--', ...pathspecs],
    'Committing',
    SLOW_MS,
  );
  return gitOut(root, ['rev-parse', 'HEAD'], 'Reading the commit').then((sha) => sha.trim());
}

export interface Remote {
  name: string;
  url: string;
}

export async function remotes(root: string): Promise<Remote[]> {
  const names = (await gitMaybe(root, ['remote']))?.split('\n').filter(Boolean) ?? [];
  const found: Remote[] = [];
  for (const name of names) {
    const url = await gitMaybe(root, ['config', '--get', `remote.${name}.url`]);
    if (url) found.push({ name, url });
  }
  return found;
}

export async function pickRemote(root: string, branch: string | null): Promise<Remote | null> {
  const all = await remotes(root);
  const upstream = branch
    ? await gitMaybe(root, ['config', '--get', `branch.${branch}.remote`])
    : null;
  return (
    all.find((remote) => remote.name === upstream) ??
    all.find((remote) => remote.name === 'origin') ??
    all[0] ??
    null
  );
}

export async function remoteHasBranch(root: string, remote: string, branch: string) {
  return (
    (await gitMaybe(root, ['rev-parse', '--verify', '-q', `refs/remotes/${remote}/${branch}`])) !==
    null
  );
}

export async function remoteDefaultBranch(root: string, remote: string): Promise<string | null> {
  const ref = await gitMaybe(root, [
    'symbolic-ref',
    '--short',
    '-q',
    `refs/remotes/${remote}/HEAD`,
  ]);
  return ref?.startsWith(`${remote}/`) ? ref.slice(remote.length + 1) : null;
}

export async function harnessCommitsToPush(
  root: string,
  remote: string,
  branch: string,
): Promise<string[]> {
  const result = await runGit(
    root,
    [
      'log',
      '--fixed-strings',
      `--author=${HARNESS_COMMIT_EMAIL}`,
      '--format=%h %s',
      `refs/heads/${branch}`,
      '--not',
      `--remotes=${remote}`,
    ],
    SLOW_MS,
  );
  if (result.code !== 0) throw failure(`Checking ${branch} before the push`, result);
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

export async function pushBranch(root: string, remote: string, branch: string): Promise<void> {
  const ref = `refs/heads/${branch}`;
  await gitOut(
    root,
    ['push', '--set-upstream', remote, `${ref}:${ref}`],
    `Pushing ${branch}`,
    SLOW_MS,
  );
}

export async function filesBetween(
  root: string,
  prefix: string,
  from: string,
  to: string,
): Promise<ShipFile[]> {
  const output = await gitOut(
    root,
    [
      'diff',
      '--name-status',
      '--no-renames',
      '-z',
      `${from}...${to}`,
      ...(prefix ? ['--', `:(top)${prefix}`] : []),
    ],
    'Listing the branch files',
  );
  return parseNameStatus(output, prefix);
}

export async function branchTip(root: string, branch: string): Promise<string | null> {
  return gitMaybe(root, ['rev-parse', '--verify', '-q', `refs/heads/${branch}^{commit}`]);
}

type IndexEnv = Record<string, string>;

async function withTaskIndex<T>(
  root: string,
  prefix: string,
  paths: readonly string[],
  start: string,
  work: (env: IndexEnv, pathspecs: string[]) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), 'spark-ship-index-'));
  const env = { GIT_INDEX_FILE: path.join(dir, 'index') };
  try {
    await gitOut(root, ['read-tree', start], 'Reading the branch', undefined, env);
    const all = paths.map((file) => topPathspec(prefix, file));
    const tracked = all.length
      ? (
          await gitOut(
            root,
            ['ls-files', '-z', '--', ...all],
            'Listing the branch files',
            undefined,
            env,
          )
        )
          .split('\0')
          .filter(Boolean)
      : [];
    const known = new Set(tracked);
    const present = paths.filter(
      (file) => known.has(`${prefix}${file}`) || existsSync(path.join(root, file)),
    );
    const pathspecs = present.map((file) => topPathspec(prefix, file));
    if (pathspecs.length > 0) {
      await gitOut(root, ['add', '-A', '--', ...pathspecs], 'Staging the task files', SLOW_MS, env);
    }
    return await work(env, pathspecs);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function filesAgainst(
  root: string,
  prefix: string,
  paths: readonly string[],
  start: string,
): Promise<ShipFile[]> {
  if (paths.length === 0) return [];
  return withTaskIndex(root, prefix, paths, start, async (env, pathspecs) => {
    if (pathspecs.length === 0) return [];
    const output = await gitOut(
      root,
      ['diff', '--cached', '--name-status', '--no-renames', '-z', start, '--', ...pathspecs],
      'Comparing the task files',
      undefined,
      env,
    );
    return parseNameStatus(output, prefix);
  });
}

export async function commitOnBranch(
  root: string,
  prefix: string,
  paths: readonly string[],
  branch: string,
  start: string,
  subject: string,
  body: string,
): Promise<string | null> {
  return withTaskIndex(root, prefix, paths, start, async (env) => {
    const tree = (await gitOut(root, ['write-tree'], 'Writing the tree', undefined, env)).trim();
    const startTree = (
      await gitOut(root, ['rev-parse', `${start}^{tree}`], 'Reading the tree')
    ).trim();
    if (tree === startTree) return null;
    const commit = (
      await gitOut(
        root,
        ['commit-tree', tree, '-p', start, '-m', subject, '-m', body],
        'Committing',
        SLOW_MS,
      )
    ).trim();
    const current = await branchTip(root, branch);
    await gitOut(
      root,
      ['update-ref', `refs/heads/${branch}`, commit, current ?? ''],
      `Updating ${branch}`,
    );
    return commit;
  });
}
