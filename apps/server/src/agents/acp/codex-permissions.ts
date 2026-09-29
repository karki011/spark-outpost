import { SECRET_FILE_PATTERNS } from '../../projects/secret-files.ts';

export const SECRET_GLOBS = SECRET_FILE_PATTERNS.map((pattern) => `**/${pattern}`);

export const CODEX_READ_ONLY_MODE = 'read-only';
export const CODEX_DO_MODE = 'ask-every-action';

function secretDenies(): Record<string, string> {
  return Object.fromEntries(SECRET_GLOBS.map((glob) => [glob, 'deny']));
}

export function codexPermissionProfiles(): Record<string, object> {
  const projectRoots = { ':project_roots': secretDenies() };
  return {
    [CODEX_READ_ONLY_MODE]: { extends: ':read-only', filesystem: projectRoots },
    [CODEX_DO_MODE]: {
      extends: ':workspace',
      filesystem: { ':slash_tmp': 'read', ...projectRoots },
    },
    agent: { extends: ':workspace', filesystem: projectRoots },
    'agent-full-access': {
      filesystem: { ':root': 'write', ...projectRoots },
      network: { enabled: true },
    },
  };
}
