import { gatePaths as path, toGatePath, toNativePath } from './gate-path.ts';
import type { GitDirs } from '../projects/path-policy.ts';
import { runGit } from '../ship/git.ts';
import { REPO_GIT_CONFIG } from './git-config.ts';

export const WORKTREE_CONFIG_LABEL = '.git/config.worktree';

interface GitRoot {
  path: string;
  gitDirs?: GitDirs | null;
}

export async function readGitDirs(root: string): Promise<GitDirs | null> {
  const found = await runGit(toNativePath(root), [
    'rev-parse',
    '--path-format=absolute',
    '--git-common-dir',
    '--git-dir',
    '--symbolic-full-name',
    'HEAD',
  ]).catch(() => null);
  if (!found || found.code !== 0) return null;
  const [common, own, head] = found.stdout.trim().split(/\r?\n/);
  if (!common || !own) return null;
  const branch = own !== common && head?.startsWith('refs/heads/') ? head : null;
  return branch ? { common, own, branch } : { common, own };
}

function hookName(dirs: GitDirs, target: string): string | null {
  const name = path.relative(path.join(dirs.common, 'hooks'), target);
  const inside = name !== '' && !name.startsWith('..') && !path.isAbsolute(name);
  return inside && !name.includes(path.sep) ? name : null;
}

function labelIn(dirs: GitDirs, target: string): string | null {
  const hook = hookName(dirs, target);
  if (hook) return `.git/hooks/${hook}`;
  if (target === path.join(dirs.common, 'config')) return REPO_GIT_CONFIG;
  const worktreeConfig =
    dirs.own !== dirs.common && target === path.join(dirs.own, 'config.worktree');
  return worktreeConfig ? WORKTREE_CONFIG_LABEL : null;
}

export function gitControlLabel(roots: readonly GitRoot[], target: string): string | null {
  const written = path.normalize(toGatePath(target));
  for (const root of roots) {
    const label = root.gitDirs ? labelIn(gateGitDirs(root.gitDirs), written) : null;
    if (label) return label;
  }
  return null;
}

export function gateGitDirs(dirs: GitDirs): GitDirs {
  return { ...dirs, common: toGatePath(dirs.common), own: toGatePath(dirs.own) };
}

function globsFor(root: GitRoot): string[] {
  if (!root.gitDirs) return [];
  const dirs = gateGitDirs(root.gitDirs);
  const shared =
    dirs.common === path.join(toGatePath(root.path), '.git')
      ? []
      : [path.join(dirs.common, 'hooks', '*'), path.join(dirs.common, 'config')];
  const own = dirs.own === dirs.common ? [] : [path.join(dirs.own, 'config.worktree')];
  return [...shared, ...own];
}

export function gitControlGlobs(roots: readonly GitRoot[]): string[] {
  return [...new Set(roots.flatMap(globsFor))];
}
