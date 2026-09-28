import { execFile } from 'node:child_process';
import type { ShipFile } from '@spark-outpost/contracts';
import { redactText } from '../audit/redact.ts';

const QUICK_MS = 15_000;
const SLOW_MS = 120_000;
const MAX_BUFFER = 16 * 1024 * 1024;

export class ShipGitError extends Error {}

interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runGit(root: string, args: string[], timeout = QUICK_MS): Promise<GitResult> {
  return new Promise((resolve) => {
    const child = execFile(
      'git',
      ['-C', root, ...args],
      {
        timeout,
        maxBuffer: MAX_BUFFER,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', SSH_ASKPASS: '' },
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

async function gitOut(root: string, args: string[], action: string, timeout?: number) {
  const result = await runGit(root, args, timeout);
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

const topPathspec = (prefix: string, path: string) => `:(top,literal)${prefix}${path}`;

function statusChange(code: string): ShipFile['change'] {
  if (code === '??' || code.includes('A')) return 'added';
  if (code.includes('D')) return 'deleted';
  return 'modified';
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

export async function pushBranch(root: string, remote: string, branch: string): Promise<void> {
  const ref = `refs/heads/${branch}`;
  await gitOut(
    root,
    ['push', '--set-upstream', remote, `${ref}:${ref}`],
    `Pushing ${branch}`,
    SLOW_MS,
  );
}

const NAME_STATUS: Record<string, ShipFile['change']> = { A: 'added', D: 'deleted' };

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
  const parts = output.split('\0').filter(Boolean);
  const files: ShipFile[] = [];
  for (let index = 0; index + 1 < parts.length; index += 2) {
    const path = parts[index + 1]!;
    if (!path.startsWith(prefix)) continue;
    const change = NAME_STATUS[parts[index]!.charAt(0)] ?? 'modified';
    files.push({ path: path.slice(prefix.length), change });
  }
  return files;
}
