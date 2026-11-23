import { browserDataDir, entryPath, guardedDataEntries } from '../../approvals/browser-data.ts';
import { guardedCrewFolders } from '../../approvals/crew-folders.ts';
import { gatePaths, toGatePath, toNativePath } from '../../approvals/gate-path.ts';
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

const WORKTREE_LINKS = ['HEAD', 'commondir', 'gitdir', 'config.worktree'];

function join(base: string, ...parts: string[]): string {
  const joined = gatePaths.join(base, ...parts);
  return base.startsWith('//') && !joined.startsWith('//') ? `/${joined}` : joined;
}

function branchRefAccess(common: string, branch: string | undefined): Record<string, string> {
  if (!branch) return {};
  const ref = join(common, branch);
  const log = join(common, 'logs', branch);
  return { [ref]: 'write', [`${ref}.lock`]: 'write', [log]: 'write' };
}

function worktreeGitAccess(native: GitDirs): Record<string, string> {
  const dirs = { ...native, own: toGatePath(native.own), common: toGatePath(native.common) };
  if (dirs.own === dirs.common) return {};
  return {
    [dirs.own]: 'write',
    ...Object.fromEntries(WORKTREE_LINKS.map((name) => [join(dirs.own, name), 'read'])),
    [join(dirs.common, 'objects')]: 'write',
    ...branchRefAccess(dirs.common, dirs.branch),
    [join(dirs.common, 'hooks')]: 'read',
    [join(dirs.common, 'config')]: 'read',
  };
}

function nativeKeys<T>(entries: Record<string, T>): Record<string, T> {
  if (process.platform !== 'win32') return entries;
  return Object.fromEntries(
    Object.entries(entries).map(([key, value]) => [
      key.startsWith('/') ? toNativePath(key) : key,
      value,
    ]),
  );
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
  const working = nativeKeys({ ...gitWrites, ...denied });
  const deniedHere = nativeKeys(denied);
  return {
    [CODEX_READ_ONLY_MODE]: { extends: ':read-only', filesystem: deniedHere },
    [CODEX_DO_MODE]: {
      extends: ':workspace',
      filesystem: { ':slash_tmp': 'read', ...working },
    },
    'workspace-write': { extends: ':workspace', filesystem: working },
    agent: { extends: ':workspace', filesystem: working },
    'agent-full-access': {
      filesystem: { ':root': 'write', ...deniedHere },
      network: { enabled: true },
    },
  };
}
