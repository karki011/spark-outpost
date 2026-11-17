import { describe, expect, it } from 'vitest';
import { SECRET_FILE_PATTERNS } from '../../projects/secret-files.ts';
import { acceptedRecordPath } from '../../spark-rules/accepted.ts';
import { codexGitWrites, codexPermissionProfiles } from './codex-permissions.ts';

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

  it("denies Spark's browser data in every mode, beside the project's secret files", () => {
    const withData = codexPermissionProfiles('/nowhere/Spark Outpost') as Record<string, Profile>;
    for (const profile of Object.values(withData)) {
      expect(profile.filesystem).toMatchObject({
        '/nowhere/Spark Outpost/Partitions': 'deny',
        '/nowhere/Spark Outpost/postgres': 'deny',
        '/nowhere/Spark Outpost/postgres-password': 'deny',
        '/nowhere/Spark Outpost/browser-origins.json': 'deny',
      });
      expect(profile.filesystem).not.toHaveProperty('/nowhere/Spark Outpost');
      expect(profile.filesystem).toMatchObject({
        [acceptedRecordPath(process.env.SPARK_RULES_FILE!)]: 'deny',
      });
    }
    const plain = codexPermissionProfiles(null, true, []) as Record<string, Profile>;
    expect(Object.keys(plain.agent!.filesystem)).toEqual([':project_roots']);
  });

  it("makes Sparks' folders and workflows read-only in every mode, Full access included", () => {
    const crew = ['/data/dev/sparks', '/data/dev/workflows'];
    const profiles = codexPermissionProfiles('/data', true, crew) as Record<string, Profile>;
    for (const profile of Object.values(profiles)) {
      expect(profile.filesystem).toMatchObject({
        '/data/dev/sparks': 'read',
        '/data/dev/workflows': 'read',
      });
    }
    expect(profiles['agent-full-access']!.filesystem).toMatchObject({ ':root': 'write' });
  });

  it("lets the working modes write a worktree's git data, never its hooks or config", () => {
    const writes = codexGitWrites([
      { common: '/repo/.git', own: '/repo/.git/worktrees/w', branch: 'refs/heads/spark/w' },
      { common: '/other/.git', own: '/other/.git' },
      null,
    ]);
    expect(writes).toEqual({
      '/repo/.git/worktrees/w': 'write',
      '/repo/.git/worktrees/w/config.worktree': 'read',
      '/repo/.git/objects': 'write',
      '/repo/.git/refs/heads/spark/w': 'write',
      '/repo/.git/refs/heads/spark/w.lock': 'write',
      '/repo/.git/logs/refs/heads/spark/w': 'write',
      '/repo/.git/hooks': 'read',
      '/repo/.git/config': 'read',
    });
    const profiles = codexPermissionProfiles(null, true, [], writes) as Record<string, Profile>;
    for (const mode of ['ask-every-action', 'workspace-write', 'agent']) {
      expect(profiles[mode]!.filesystem).toMatchObject(writes);
    }
    expect(profiles['read-only']!.filesystem).not.toHaveProperty('/repo/.git/objects');
    expect(profiles['agent-full-access']!.filesystem).not.toHaveProperty('/repo/.git/hooks');
  });
});
