import { runGit } from '../ship/git.ts';
import { pushedHead } from '../ship/published.ts';

export interface BranchWork {
  uncommitted: boolean;
  commits: boolean;
  pushed: boolean;
}

export async function branchWork(
  root: string,
  branch: string,
  baseCommit: string,
): Promise<BranchWork> {
  const status = await runGit(root, ['status', '--porcelain']);
  const ahead = await runGit(root, ['rev-list', '--count', `${baseCommit}..refs/heads/${branch}`]);
  const { pushed } = await pushedHead(root, branch);
  return {
    uncommitted: status.code === 0 && status.stdout.trim() !== '',
    commits: ahead.code === 0 && Number(ahead.stdout.trim()) > 0,
    pushed,
  };
}

export function notPushed(work: BranchWork): boolean {
  return work.uncommitted || (work.commits && !work.pushed);
}

export function pushedInFull(work: BranchWork): boolean {
  return work.commits && work.pushed && !work.uncommitted;
}
