import { defaultBranch } from '../projects/chat-worktrees.ts';
import { pickRemote, remoteHasBranch, runGit } from '../ship/git.ts';
import type { StackGit } from './ports.ts';

export const NO_REMOTE = 'This repository has no git remote.';

export interface StackRepo extends StackGit {
  hasBranch(repoRoot: string, branch: string): Promise<boolean>;
  defaultBranch(repoRoot: string): Promise<string | null>;
}

function unreadable(what: string, stderr: string): Error {
  return new Error(`${what}: ${stderr.trim().split('\n')[0] ?? ''}`.trim());
}

async function isAncestor(repoRoot: string, ancestor: string, descendant: string) {
  const result = await runGit(repoRoot, [
    'merge-base',
    '--is-ancestor',
    `refs/heads/${ancestor}`,
    `refs/heads/${descendant}`,
  ]);
  if (result.code === 0) return true;
  if (result.code === 1) return false;
  throw unreadable(`Could not compare ${ancestor} and ${descendant}`, result.stderr);
}

async function branchOnRemote(repoRoot: string, branch: string) {
  const remote = await pickRemote(repoRoot, branch);
  if (!remote) throw new Error(NO_REMOTE);
  return remoteHasBranch(repoRoot, remote.name, branch);
}

async function hasBranch(repoRoot: string, branch: string) {
  const local = await runGit(repoRoot, ['rev-parse', '--verify', '-q', `refs/heads/${branch}`]);
  if (local.code === 0) return true;
  return branchOnRemote(repoRoot, branch).catch(() => false);
}

export const stackGit: StackRepo = { isAncestor, branchOnRemote, hasBranch, defaultBranch };
