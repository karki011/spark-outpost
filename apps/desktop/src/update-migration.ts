import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Backup } from './data-backup.ts';

export interface MigrationMarker {
  version: string;
  migratedAt: string;
}

export interface PendingMigrations {
  pending: string[];
  fresh: boolean;
}

export type MigrateOutcome = { ok: true } | { ok: false; detail: string };

export interface MigrationGuardEffects {
  pending(): Promise<PendingMigrations>;
  backup(previousVersion: string | null): Promise<Backup>;
  rotate(): Promise<void>;
  migrate(): Promise<MigrateOutcome>;
  restore(backup: Backup): Promise<void>;
  readMarker(): Promise<MigrationMarker | null>;
  writeMarker(marker: MigrationMarker): Promise<void>;
  recordFailure(version: string): Promise<void>;
  now(): Date;
}

export type GuardResult =
  | { status: 'current' }
  | { status: 'migrated'; applied: string[]; backup: Backup | null }
  | {
      status: 'restored';
      detail: string;
      backup: Backup;
      previousVersion: string | null;
    }
  | {
      status: 'unrestored';
      detail: string;
      backup: Backup | null;
      previousVersion: string | null;
    };

async function restoreAfterFailure(
  effects: MigrationGuardEffects,
  backup: Backup | null,
  detail: string,
  previousVersion: string | null,
): Promise<GuardResult> {
  if (!backup) return { status: 'unrestored', detail, backup, previousVersion };
  try {
    await effects.restore(backup);
    return { status: 'restored', detail, backup, previousVersion };
  } catch (error) {
    const reason = `${detail}\nRestoring the backup also failed: ${(error as Error).message}`;
    return { status: 'unrestored', detail: reason, backup, previousVersion };
  }
}

export async function guardMigrations(
  version: string,
  effects: MigrationGuardEffects,
): Promise<GuardResult> {
  const marker = await effects.readMarker();
  const previousVersion = marker?.version ?? null;
  const { pending, fresh } = await effects.pending();
  if (pending.length === 0) {
    if (previousVersion !== version) {
      await effects.writeMarker({ version, migratedAt: effects.now().toISOString() });
    }
    return { status: 'current' };
  }
  let backup: Backup | null = null;
  if (!fresh) {
    backup = await effects.backup(previousVersion);
    await effects.rotate();
  }
  const outcome = await effects.migrate();
  if (!outcome.ok) {
    await effects.recordFailure(version);
    return restoreAfterFailure(effects, backup, outcome.detail, previousVersion);
  }
  await effects.writeMarker({ version, migratedAt: effects.now().toISOString() });
  return { status: 'migrated', applied: pending, backup };
}

export function markerFile(userData: string): string {
  return path.join(userData, 'migrated-version.json');
}

export async function readMarker(file: string): Promise<MigrationMarker | null> {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as Partial<MigrationMarker>;
    if (typeof parsed.version !== 'string' || typeof parsed.migratedAt !== 'string') return null;
    return { version: parsed.version, migratedAt: parsed.migratedAt };
  } catch {
    return null;
  }
}

export async function writeMarker(file: string, marker: MigrationMarker): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const partial = `${file}.partial`;
  await writeFile(partial, `${JSON.stringify(marker, null, 2)}\n`, { mode: 0o600 });
  await rename(partial, file);
}

export function skippedVersionFile(userData: string): string {
  return path.join(userData, 'skipped-update.json');
}

export async function readSkippedVersion(file: string): Promise<string | null> {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as { version?: unknown };
    return typeof parsed.version === 'string' ? parsed.version : null;
  } catch {
    return null;
  }
}

export async function writeSkippedVersion(file: string, version: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify({ version }, null, 2)}\n`, { mode: 0o600 });
}
