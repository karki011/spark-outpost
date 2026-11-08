import { browserDataDir, entryPath, guardedDataEntries } from '../../approvals/browser-data.ts';
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

export function codexPermissionProfiles(
  dataDir: string | null = browserDataDir(),
  secrets = true,
): Record<string, object> {
  const projectRoots = secrets ? { ':project_roots': secretDenies() } : {};
  const denied = { ...projectRoots, ...browserDataDenies(dataDir) };
  return {
    [CODEX_READ_ONLY_MODE]: { extends: ':read-only', filesystem: denied },
    [CODEX_DO_MODE]: {
      extends: ':workspace',
      filesystem: { ':slash_tmp': 'read', ...denied },
    },
    'workspace-write': { extends: ':workspace', filesystem: denied },
    agent: { extends: ':workspace', filesystem: denied },
    'agent-full-access': {
      filesystem: { ':root': 'write', ...denied },
      network: { enabled: true },
    },
  };
}
