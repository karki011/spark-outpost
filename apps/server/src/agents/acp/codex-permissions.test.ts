import { describe, expect, it } from 'vitest';
import { SECRET_FILE_PATTERNS } from '../../projects/secret-files.ts';
import { codexPermissionProfiles } from './codex-permissions.ts';

type Profile = {
  extends?: string;
  filesystem: Record<string, unknown> & { ':project_roots': Record<string, string> };
  network?: { enabled: boolean };
};

const profiles = codexPermissionProfiles() as Record<string, Profile>;

describe('codexPermissionProfiles', () => {
  it.each(Object.keys(profiles))('denies every secret file pattern in %s', (mode) => {
    const denied = profiles[mode]!.filesystem[':project_roots'];
    for (const pattern of SECRET_FILE_PATTERNS) expect(denied[`**/${pattern}`]).toBe('deny');
    expect(Object.values(denied).every((access) => access === 'deny')).toBe(true);
  });

  it('keeps each mode as open as the sandbox it replaces', () => {
    expect(profiles['read-only']).toMatchObject({ extends: ':read-only' });
    expect(profiles['ask-every-action']).toMatchObject({
      extends: ':workspace',
      filesystem: { ':slash_tmp': 'read' },
    });
    expect(profiles.agent).toMatchObject({ extends: ':workspace' });
    expect(profiles['agent-full-access']).toMatchObject({
      filesystem: { ':root': 'write' },
      network: { enabled: true },
    });
    expect(profiles['agent-full-access']).not.toHaveProperty('extends');
  });
});
