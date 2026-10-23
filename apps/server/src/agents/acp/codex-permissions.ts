import { join } from 'node:path';
import { BROWSER_DATA_ENTRIES, browserDataDir } from '../../approvals/browser-data.ts';
import { SECRET_FILE_PATTERNS } from '../../projects/secret-files.ts';

export const SECRET_GLOBS = SECRET_FILE_PATTERNS.map((pattern) => `**/${pattern}`);

export const CODEX_READ_ONLY_MODE = 'read-only';
export const CODEX_DO_MODE = 'ask-every-action';

function secretDenies(): Record<string, string> {
  return Object.fromEntries(SECRET_GLOBS.map((glob) => [glob, 'deny']));
}

function browserDataDenies(dataDir: string | null): Record<string, string> {
  if (!dataDir) return {};
  return Object.fromEntries(BROWSER_DATA_ENTRIES.map((entry) => [join(dataDir, entry), 'deny']));
}

export function codexPermissionProfiles(
  dataDir: string | null = browserDataDir(),
): Record<string, object> {
  const denied = { ':project_roots': secretDenies(), ...browserDataDenies(dataDir) };
  return {
    [CODEX_READ_ONLY_MODE]: { extends: ':read-only', filesystem: denied },
    [CODEX_DO_MODE]: {
      extends: ':workspace',
      filesystem: { ':slash_tmp': 'read', ...denied },
    },
    agent: { extends: ':workspace', filesystem: denied },
    'agent-full-access': {
      filesystem: { ':root': 'write', ...denied },
      network: { enabled: true },
    },
  };
}
