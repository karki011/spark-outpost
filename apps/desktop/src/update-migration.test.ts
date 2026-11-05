import { describe, expect, it } from 'vitest';
import type { Backup } from './data-backup.ts';
import {
  guardMigrations,
  type MigrateOutcome,
  type MigrationGuardEffects,
  type MigrationMarker,
  type PendingMigrations,
} from './update-migration.ts';

const NOW = new Date('2026-10-01T12:00:00.000Z');
const BACKUP: Backup = { kind: 'copy', path: '/data/backups/update-1' };

interface Script {
  marker?: MigrationMarker | null;
  pending?: PendingMigrations;
  migrate?: MigrateOutcome;
  backupError?: Error;
  restoreError?: Error;
}

function fakeEffects(script: Script) {
  const calls: string[] = [];
  const written: MigrationMarker[] = [];
  const failed: string[] = [];
  const effects: MigrationGuardEffects = {
    pending: async () => script.pending ?? { pending: [], fresh: false },
    backup: async (previous) => {
      calls.push(`backup:${previous}`);
      if (script.backupError) throw script.backupError;
      return BACKUP;
    },
    rotate: async () => {
      calls.push('rotate');
    },
    migrate: async () => {
      calls.push('migrate');
      return script.migrate ?? { ok: true };
    },
    restore: async (backup) => {
      calls.push(`restore:${backup.path}`);
      if (script.restoreError) throw script.restoreError;
    },
    readMarker: async () => script.marker ?? null,
    writeMarker: async (marker) => {
      written.push(marker);
    },
    recordFailure: async (version) => {
      failed.push(version);
    },
    now: () => NOW,
  };
  return { effects, calls, written, failed };
}

const OLD = { version: '0.1.0', migratedAt: '2026-09-01T00:00:00.000Z' };
const PENDING = { pending: ['0087_new.sql'], fresh: false };

describe('guardMigrations', () => {
  it('records a new version without a backup when nothing needs migrating', async () => {
    const { effects, calls, written } = fakeEffects({ marker: OLD });

    expect(await guardMigrations('0.2.0', effects)).toEqual({ status: 'current' });
    expect(calls).toEqual([]);
    expect(written).toEqual([{ version: '0.2.0', migratedAt: NOW.toISOString() }]);
  });

  it('leaves the record alone when the same version starts again', async () => {
    const { effects, written } = fakeEffects({ marker: { ...OLD, version: '0.2.0' } });

    await guardMigrations('0.2.0', effects);

    expect(written).toEqual([]);
  });

  it('backs up and rotates before migrating, then records the version', async () => {
    const { effects, calls, written } = fakeEffects({ marker: OLD, pending: PENDING });

    expect(await guardMigrations('0.2.0', effects)).toEqual({
      status: 'migrated',
      applied: ['0087_new.sql'],
      backup: BACKUP,
    });
    expect(calls).toEqual(['backup:0.1.0', 'rotate', 'migrate']);
    expect(written).toEqual([{ version: '0.2.0', migratedAt: NOW.toISOString() }]);
  });

  it('skips the backup for a brand-new database', async () => {
    const { effects, calls } = fakeEffects({ pending: { pending: ['0001.sql'], fresh: true } });

    expect(await guardMigrations('0.2.0', effects)).toMatchObject({
      status: 'migrated',
      backup: null,
    });
    expect(calls).toEqual(['migrate']);
  });

  it('migrates nothing when the backup fails', async () => {
    const { effects, calls, written } = fakeEffects({
      marker: OLD,
      pending: PENDING,
      backupError: new Error('disk full'),
    });

    await expect(guardMigrations('0.2.0', effects)).rejects.toThrow('disk full');
    expect(calls).toEqual(['backup:0.1.0']);
    expect(written).toEqual([]);
  });

  it('restores the backup when a migration fails and skips that version from then on', async () => {
    const { effects, calls, written, failed } = fakeEffects({
      marker: OLD,
      pending: PENDING,
      migrate: { ok: false, detail: 'Migration 0087_new.sql failed: boom' },
    });

    expect(await guardMigrations('0.2.0', effects)).toEqual({
      status: 'restored',
      detail: 'Migration 0087_new.sql failed: boom',
      backup: BACKUP,
      previousVersion: '0.1.0',
    });
    expect(calls).toEqual(['backup:0.1.0', 'rotate', 'migrate', `restore:${BACKUP.path}`]);
    expect(written).toEqual([]);
    expect(failed).toEqual(['0.2.0']);
  });

  it('reports a restore that did not finish without hiding the migration error', async () => {
    const { effects } = fakeEffects({
      marker: OLD,
      pending: PENDING,
      migrate: { ok: false, detail: 'boom' },
      restoreError: new Error('permission denied'),
    });

    const result = await guardMigrations('0.2.0', effects);

    expect(result).toMatchObject({
      status: 'unrestored',
      backup: BACKUP,
      previousVersion: '0.1.0',
    });
    expect(result.status === 'unrestored' && result.detail).toBe(
      'boom\nRestoring the backup also failed: permission denied',
    );
  });
});
