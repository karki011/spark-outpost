import { branchTip, runGit } from '../ship/git.ts';

export type BranchSync = 'same' | 'ahead' | 'fast_forwarded' | 'diverged' | 'unreachable';

const FETCH_MS = 60_000;

async function ok(root: string, args: string[], timeout?: number): Promise<boolean> {
  return (await runGit(root, args, timeout)).code === 0;
}

const isAncestor = (root: string, older: string, newer: string) =>
  ok(root, ['merge-base', '--is-ancestor', older, newer]);

async function currentBranch(root: string): Promise<string | null> {
  const result = await runGit(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  return result.code === 0 ? result.stdout.trim() : null;
}

async function clean(root: string): Promise<boolean> {
  const result = await runGit(root, ['status', '--porcelain', '--untracked-files=no']);
  return result.code === 0 && result.stdout.trim() === '';
}

async function fastForward(root: string, branch: string, from: string, to: string) {
  if ((await currentBranch(root)) !== branch) {
    return ok(root, ['update-ref', `refs/heads/${branch}`, to, from]);
  }
  if (!(await clean(root))) return false;
  return ok(root, ['merge', '--ff-only', '--quiet', to]);
}

export async function syncWithPull(
  root: string,
  remote: string,
  branch: string,
  headSha: string,
): Promise<BranchSync> {
  const local = await branchTip(root, branch);
  if (!local) return 'unreachable';
  if (local === headSha) return 'same';
  if (!(await ok(root, ['cat-file', '-e', `${headSha}^{commit}`]))) {
    await runGit(root, ['fetch', '--quiet', remote, branch], FETCH_MS);
    if (!(await ok(root, ['cat-file', '-e', `${headSha}^{commit}`]))) return 'unreachable';
  }
  if (await isAncestor(root, headSha, local)) return 'ahead';
  if (await isAncestor(root, local, headSha)) {
    return (await fastForward(root, branch, local, headSha)) ? 'fast_forwarded' : 'diverged';
  }
  return 'diverged';
}
