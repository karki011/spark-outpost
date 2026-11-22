import { execFileSync } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { CHAT_BRANCH } from './publish-step-support.ts';
import { REMOTE_URL, git, repoWithRemote, write } from './ship-support.ts';

export const PULL_NUMBER = 7;
export const PULL_URL = `https://github.com/acme/widgets/pull/${PULL_NUMBER}`;
export const PULL_ID = `acme/widgets#${PULL_NUMBER}`;

export interface PullRepo {
  root: string;
  bare: string;
  pullHead: string;
}

export async function repoWithPull(base: string, name: string): Promise<PullRepo> {
  const repo = await repoWithRemote(base, name);
  const root = await realpath(repo.root);
  git(root, 'config', `url.${repo.bare}.insteadOf`, REMOTE_URL);
  git(root, 'checkout', '-q', '-b', 'fork-work');
  await write(root, 'notes.txt', 'from the pull request\n');
  git(root, 'commit', '-qam', 'pull request work');
  const pullHead = git(root, 'rev-parse', 'HEAD');
  execFileSync('git', [
    '-C',
    root,
    'push',
    '-q',
    repo.bare,
    `${pullHead}:refs/pull/${PULL_NUMBER}/head`,
  ]);
  git(root, 'checkout', '-q', 'main');
  git(root, 'branch', '-q', '-D', 'fork-work');
  git(root, 'checkout', '-q', '-b', CHAT_BRANCH);
  return { root, bare: repo.bare, pullHead };
}

export function worktreeList(root: string): string {
  return git(root, 'worktree', 'list', '--porcelain');
}

export function checkoutRefs(root: string): string {
  return git(root, 'for-each-ref', '--format=%(refname)', 'refs/spark-outpost/pr-checkouts/');
}
