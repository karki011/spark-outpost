import { describe, expect, it } from 'vitest';
import type { Backup } from './data-backup.ts';
import {
  BOOT_STATUS,
  leaveDelay,
  MIN_BOOT_MS,
  reportingSteps,
  type BootStep,
} from './boot-steps.ts';
import {
  guardMigrations,
  type MigrateOutcome,
  type MigrationGuardEffects,
  type MigrationMarker,
  type PendingMigrations,
} from './update-migration.ts';

const BACKUP: Backup = { kind: 'dump', path: '/data/backups/update.dump' };
const OLD: MigrationMarker = { version: '0.1.0', migratedAt: '2026-09-01T00:00:00.000Z' };

function effects(
  pending: PendingMigrations,
  marker: MigrationMarker | null,
  migrate: MigrateOutcome = { ok: true },
) {
  const order: string[] = [];
  const base: MigrationGuardEffects = {
    pending: async () => pending,
    backup: async () => {
      order.push('backup ran');
      return BACKUP;
    },
    rotate: async () => undefined,
    migrate: async () => {
      order.push('migrate ran');
      return migrate;
    },
    restore: async () => {
      order.push('restore ran');
    },
    readMarker: async () => marker,
    writeMarker: async () => undefined,
    recordFailure: async () => undefined,
    now: () => new Date('2026-10-02T09:00:00.000Z'),
  };
  const wrapped = reportingSteps(base, (step: BootStep) => order.push(step));
  return { wrapped, order };
}

describe('boot steps during startup migrations', () => {
  it('reports nothing when the data is already current', async () => {
    const { wrapped, order } = effects({ pending: [], fresh: false }, OLD);
    await guardMigrations('0.2.0', wrapped);
    expect(order).toEqual([]);
  });

  it('reports the backup before it runs and then the update', async () => {
    const { wrapped, order } = effects({ pending: ['0090_new.sql'], fresh: false }, OLD);
    await guardMigrations('0.2.0', wrapped);
    expect(order).toEqual(['backup', 'backup ran', 'migrate', 'migrate ran']);
  });

  it('skips the backup step on a fresh install', async () => {
    const { wrapped, order } = effects({ pending: ['0001_init.sql'], fresh: true }, null);
    await guardMigrations('0.2.0', wrapped);
    expect(order).toEqual(['migrate', 'migrate ran']);
  });

  it('keeps reporting truthfully when the update fails and the backup is restored', async () => {
    const { wrapped, order } = effects({ pending: ['0090_new.sql'], fresh: false }, OLD, {
      ok: false,
      detail: 'boom',
    });
    const result = await guardMigrations('0.2.0', wrapped);
    expect(result.status).toBe('restored');
    expect(order).toEqual(['backup', 'backup ran', 'migrate', 'migrate ran', 'restore ran']);
  });
});

describe('boot status lines', () => {
  it('maps each step to one short line', () => {
    expect(BOOT_STATUS).toEqual({
      waking: 'Waking up…',
      database: 'Starting the database…',
      backup: 'Backing up before the update…',
      migrate: 'Updating your data…',
      spark: 'Starting Spark…',
    });
  });
});

describe('leaving the boot screen', () => {
  it('holds the boot screen until it has been visible for the minimum', () => {
    expect(leaveDelay(1_000, 1_100)).toBe(MIN_BOOT_MS - 100);
  });

  it('fades right away once the minimum has passed', () => {
    expect(leaveDelay(1_000, 1_000 + MIN_BOOT_MS)).toBe(0);
    expect(leaveDelay(1_000, 9_000)).toBe(0);
  });

  it('does not wait when the window never showed', () => {
    expect(leaveDelay(null, 5_000)).toBe(0);
  });
});
