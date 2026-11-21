import { defaultBranch } from '../projects/chat-worktrees.ts';
import { pickRemote, remoteHasBranch, runGit } from '../ship/git.ts';

export const NO_REMOTE = 'This repository has no git remote.';

export interface StackRepo {
  branchOnRemote(repoRoot: string, branch: string): Promise<boolean>;
  hasBranch(repoRoot: string, branch: string): Promise<boolean>;
  defaultBranch(repoRoot: string): Promise<string | null>;
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

export const stackGit: StackRepo = { branchOnRemote, hasBranch, defaultBranch };
