import { browserDataDir, entryPath, guardedDataEntries } from '../../approvals/browser-data.ts';
import { guardedCrewFolders } from '../../approvals/crew-folders.ts';
import { join } from 'node:path';
import type { GitDirs } from '../../projects/path-policy.ts';
import { SECRET_FILE_PATTERNS } from '../../projects/secret-files.ts';

export const SECRET_GLOBS = SECRET_FILE_PATTERNS.map((pattern) => `**/${pattern}`);

export const CODEX_READ_ONLY_MODE = 'read-only';
export const CODEX_DO_MODE = 'ask-every-action';

function secretDenies(): Record<string, string> {
  return Object.fromEntries(SECRET_GLOBS.map((glob) => [glob, 'deny']));
}

function browserDataDenies(dataDir: string | null): Record<string, string> {
  if (!dataDir) return {};
  return Object.fromEntries(
    guardedDataEntries().map((entry) => [entryPath(dataDir, entry), 'deny']),
  );
}

function crewReadOnly(folders: readonly string[]): Record<string, string> {
  return Object.fromEntries(folders.map((folder) => [folder, 'read']));
}

function worktreeGitAccess(dirs: GitDirs): Record<string, string> {
  if (dirs.own === dirs.common) return {};
  return {
    [dirs.own]: 'write',
    [join(dirs.own, 'config.worktree')]: 'read',
    [join(dirs.common, 'objects')]: 'write',
    [join(dirs.common, 'refs')]: 'write',
    [join(dirs.common, 'logs')]: 'write',
    [join(dirs.common, 'hooks')]: 'read',
    [join(dirs.common, 'config')]: 'read',
  };
}

export function codexGitWrites(gitDirs: readonly (GitDirs | null | undefined)[]) {
  return Object.assign({}, ...gitDirs.flatMap((dirs) => (dirs ? [worktreeGitAccess(dirs)] : [])));
}

export function codexPermissionProfiles(
  dataDir: string | null = browserDataDir(),
  secrets = true,
  crew: readonly string[] = guardedCrewFolders(),
  gitWrites: Record<string, string> = {},
): Record<string, object> {
  const projectRoots = secrets ? { ':project_roots': secretDenies() } : {};
  const denied = { ...projectRoots, ...crewReadOnly(crew), ...browserDataDenies(dataDir) };
  const working = { ...gitWrites, ...denied };
  return {
    [CODEX_READ_ONLY_MODE]: { extends: ':read-only', filesystem: denied },
    [CODEX_DO_MODE]: {
      extends: ':workspace',
      filesystem: { ':slash_tmp': 'read', ...working },
    },
    'workspace-write': { extends: ':workspace', filesystem: working },
    agent: { extends: ':workspace', filesystem: working },
    'agent-full-access': {
      filesystem: { ':root': 'write', ...denied },
      network: { enabled: true },
    },
  };
}
