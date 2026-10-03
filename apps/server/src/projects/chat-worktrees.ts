import { execFile } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { commitWorkingTree, git, headCommit } from './snapshot.ts';
import { applyTree, excludeSparkDir, tryMerge } from './worktrees.ts';

const run = promisify(execFile);
const FETCH_TIMEOUT_MS = 15_000;

export interface BranchList {
  current: string | null;
  local: string[];
  remote: Map<string, string>;
}

export type WorktreeSource =
  | { kind: 'new'; branch: string; from: string }
  | { kind: 'existing'; branch: string }
  | { kind: 'remote'; branch: string; ref: string };

export type BringOutcome =
  | { status: 'applied'; files: string[]; result: string }
  | { status: 'dirty'; files: string[] }
  | { status: 'conflict'; files: string[] }
  | { status: 'nothing' };

function lines(output: string): string[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

async function succeeds(root: string, args: string[]): Promise<boolean> {
  try {
    await git(root, args);
    return true;
  } catch {
    return false;
  }
}

export async function currentBranch(root: string): Promise<string | null> {
  const name = await git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']).catch(() => '');
  return name.trim() || null;
}

export async function listBranches(root: string): Promise<BranchList> {
  const [current, local, remote] = await Promise.all([
    currentBranch(root),
    git(root, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']).catch(() => ''),
    git(root, ['for-each-ref', '--format=%(refname:short)', 'refs/remotes']).catch(() => ''),
  ]);
  const remotes = new Map<string, string>();
  for (const ref of lines(remote)) {
    const slash = ref.indexOf('/');
    const branch = slash > 0 ? ref.slice(slash + 1) : '';
    if (branch && branch !== 'HEAD' && !remotes.has(branch)) remotes.set(branch, ref);
  }
  return { current, local: lines(local), remote: remotes };
}

export async function changedFiles(root: string): Promise<string[]> {
  const output = await git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  const files: string[] = [];
  const entries = output.split('\0');
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    if (entry.length < 4) continue;
    files.push(entry.slice(3));
    if (entry[0] === 'R' || entry[0] === 'C') index += 1;
  }
  return files;
}

export async function defaultBranch(root: string): Promise<string | null> {
  const remoteHead = await git(root, [
    'symbolic-ref',
    '--quiet',
    '--short',
    'refs/remotes/origin/HEAD',
  ])
    .then((ref) => ref.trim().replace(/^origin\//, ''))
    .catch(() => '');
  const candidates = [remoteHead, 'main', 'master'].filter(Boolean);
  for (const branch of candidates) {
    if (await succeeds(root, ['rev-parse', '--verify', '-q', `refs/heads/${branch}`]))
      return branch;
  }
  return null;
}

async function remoteRef(root: string, ref: string): Promise<boolean> {
  return succeeds(root, ['rev-parse', '--verify', '-q', `refs/remotes/${ref}^{commit}`]);
}

export async function freshRemoteDefault(root: string): Promise<string | null> {
  if (!(await succeeds(root, ['remote', 'get-url', 'origin']))) return null;
  await run('git', ['-C', root, 'fetch', '--quiet', 'origin'], {
    timeout: FETCH_TIMEOUT_MS,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  }).catch(() => undefined);
  const head = await git(root, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'])
    .then((ref) => ref.trim())
    .catch(() => '');
  for (const ref of [head, 'origin/main', 'origin/master'].filter(Boolean)) {
    if (await remoteRef(root, ref)) return ref;
  }
  return null;
}

export async function isAncestor(root: string, older: string, newer: string): Promise<boolean> {
  return succeeds(root, ['merge-base', '--is-ancestor', older, newer]);
}

export async function branchCheckedOut(root: string, branch: string): Promise<boolean> {
  const listed = await git(root, ['worktree', 'list', '--porcelain']).catch(() => '');
  return lines(listed).includes(`branch refs/heads/${branch}`);
}

async function fetchBranch(root: string, ref: string): Promise<void> {
  const slash = ref.indexOf('/');
  if (slash <= 0) return;
  await run('git', ['-C', root, 'fetch', '--quiet', ref.slice(0, slash), ref.slice(slash + 1)], {
    timeout: FETCH_TIMEOUT_MS,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  }).catch(() => undefined);
}

export async function addChatWorktree(
  root: string,
  target: string,
  source: WorktreeSource,
): Promise<void> {
  await excludeSparkDir(root);
  await mkdir(path.dirname(target), { recursive: true });
  await git(root, ['worktree', 'prune']).catch(() => undefined);
  if (source.kind === 'new') {
    await git(root, ['worktree', 'add', '--quiet', '-b', source.branch, target, source.from]);
  } else if (source.kind === 'existing') {
    await git(root, ['worktree', 'add', '--quiet', target, source.branch]);
  } else {
    await fetchBranch(root, source.ref);
    await git(root, [
      'worktree',
      'add',
      '--quiet',
      '--track',
      '-b',
      source.branch,
      target,
      source.ref,
    ]);
  }
}

export async function branchTipOf(root: string, branch: string): Promise<string | null> {
  const tip = await git(root, [
    'rev-parse',
    '--verify',
    '-q',
    `refs/heads/${branch}^{commit}`,
  ]).catch(() => '');
  return tip.trim() || null;
}

async function ancestorOf(root: string, tip: string, ref: string): Promise<boolean> {
  return succeeds(root, ['merge-base', '--is-ancestor', tip, ref]);
}

async function mergedInto(root: string, tip: string): Promise<boolean> {
  const head = await headCommit(root);
  if (head && (await ancestorOf(root, tip, head))) return true;
  const remoteDefault = await git(root, ['rev-parse', '--verify', '-q', 'refs/remotes/origin/HEAD'])
    .then((ref) => ref.trim())
    .catch(() => '');
  return remoteDefault !== '' && (await ancestorOf(root, tip, remoteDefault));
}

async function pushed(root: string, tip: string): Promise<boolean> {
  const remotes = await git(root, ['branch', '-r', '--contains', tip]).catch(() => '');
  return lines(remotes).length > 0;
}

export async function branchSafeToDelete(
  root: string,
  branch: string,
  baseCommit: string,
): Promise<boolean> {
  const tip = await branchTipOf(root, branch);
  if (!tip || tip === baseCommit) return true;
  return (await pushed(root, tip)) || (await mergedInto(root, tip));
}

export async function branchMerged(root: string, branch: string, baseCommit: string) {
  const tip = await branchTipOf(root, branch);
  if (!tip || tip === baseCommit) return false;
  return mergedInto(root, tip);
}

export async function saveWorktreeWork(copy: string, branch: string, message: string) {
  const head = await headCommit(copy);
  const commit = await commitWorkingTree(copy, head ? [head] : [], message);
  await git(copy, ['update-ref', `refs/heads/${branch}`, commit]);
  await git(copy, ['reset', '--quiet']).catch(() => undefined);
  return commit;
}

export async function removeWorktreeDir(root: string, target: string): Promise<void> {
  await git(root, ['worktree', 'remove', '--force', target]).catch(() => undefined);
  await rm(target, { recursive: true, force: true });
  await git(root, ['worktree', 'prune']).catch(() => undefined);
}

export async function deleteBranch(root: string, branch: string): Promise<void> {
  await git(root, ['branch', '-D', branch]).catch(() => undefined);
}

async function namesBetween(root: string, from: string, to: string): Promise<string[]> {
  return lines(await git(root, ['diff', '--name-only', '--no-renames', from, to]));
}

export async function bringChanges(
  root: string,
  copy: string,
  from: string,
): Promise<BringOutcome> {
  const dirty = await changedFiles(root);
  if (dirty.length > 0) return { status: 'dirty', files: dirty };
  const result = await commitWorkingTree(copy, [from], 'Spark Outpost: chat changes to bring');
  const changed = await namesBetween(root, from, result);
  if (changed.length === 0) return { status: 'nothing' };
  const attempt = await tryMerge(root, from, result);
  if (attempt.conflicts.length > 0) return { status: 'conflict', files: attempt.conflicts };
  const files = await namesBetween(root, attempt.current, attempt.tree);
  await applyTree(root, attempt.current, attempt.tree);
  return { status: 'applied', files, result };
}
