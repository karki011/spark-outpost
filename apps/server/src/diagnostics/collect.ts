import { open, readdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { isBetaVersion, type ConnectableSetup } from '@spark-outpost/contracts';
import type { Queryable } from '../persistence/db.ts';
import { getSetupState } from '../persistence/setup.ts';
import type { ConnectionFact, DiagnosticsFacts, LogFile } from './report.ts';

export interface DiagnosticsSources {
  db: Queryable;
  workspaceId: string;
  appVersion: string | null;
  logDir: string | null;
  dataDir: string | null;
  now?: () => Date;
}

export const LOG_TAIL_BYTES = 2 * 1024 * 1024;
const LATEST_MIGRATIONS = 10;
const DESKTOP_SETTINGS = ['updates.json', 'companion.json'];
const DESKTOP_MARKERS = ['migrated-version.json', 'skipped-update.json'];

function connectionFact(entry: ConnectableSetup): ConnectionFact {
  return {
    name: entry.name,
    connected: entry.connection !== null,
    method: entry.connection?.method ?? null,
  };
}

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

async function jsonFiles(dir: string | null, names: string[]): Promise<Record<string, unknown>> {
  if (!dir) return {};
  const entries = await Promise.all(
    names.map(async (name) => [name, await readJson(path.join(dir, name))] as const),
  );
  return Object.fromEntries(entries.filter(([, value]) => value !== null));
}

async function tail(file: string, limit: number): Promise<LogFile> {
  const handle = await open(file, 'r');
  try {
    const { size } = await handle.stat();
    const length = Math.min(size, limit);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, size - length);
    return { name: path.basename(file), text: buffer.toString('utf8'), truncated: size > limit };
  } finally {
    await handle.close();
  }
}

export async function recentLogs(dir: string | null, limit = LOG_TAIL_BYTES): Promise<LogFile[]> {
  if (!dir) return [];
  const names = await readdir(dir).catch(() => [] as string[]);
  const logs = names.filter((name) => name.endsWith('.log')).sort();
  return Promise.all(logs.map((name) => tail(path.join(dir, name), limit)));
}

async function appliedMigrations(db: Queryable) {
  const { rows } = await db.query<{ name: string }>(
    'SELECT name FROM schema_migrations ORDER BY name',
  );
  return {
    applied: rows.length,
    latest: rows.slice(-LATEST_MIGRATIONS).map((row) => row.name),
  };
}

export async function collectDiagnostics(sources: DiagnosticsSources): Promise<DiagnosticsFacts> {
  const [setup, migrations, desktopSettings, desktopMarkers, logs] = await Promise.all([
    getSetupState(sources.db, sources.workspaceId),
    appliedMigrations(sources.db),
    jsonFiles(sources.dataDir, DESKTOP_SETTINGS),
    jsonFiles(sources.dataDir, DESKTOP_MARKERS),
    recentLogs(sources.logDir),
  ]);
  return {
    createdAt: sources.now?.() ?? new Date(),
    about: {
      appVersion: sources.appVersion,
      beta: sources.appVersion ? isBetaVersion(sources.appVersion) : false,
      electron: process.versions.electron ?? null,
      node: process.versions.node,
      os: {
        platform: os.platform(),
        release: os.release(),
        version: os.version(),
        arch: os.arch(),
      },
      processArch: process.arch,
    },
    providers: setup.providers.map(connectionFact),
    advisors: setup.advisors.map(connectionFact),
    settings: setup.profile,
    desktopSettings,
    migrations,
    desktopMarkers,
    logs,
  };
}
