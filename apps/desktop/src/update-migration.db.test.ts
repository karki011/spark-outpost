import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../../server/src/persistence/db.ts';
import { runMigrations } from '../../server/src/persistence/migrate.ts';
import {
  backupName,
  dumpDatabase,
  DUMP_TOOL_DIRS,
  findDumpTools,
  restoreDump,
  rotateBackups,
  type DumpTools,
} from './data-backup.ts';
import { pendingMigrations } from './migration-status.ts';
import { freePort } from './ports.ts';
import { startDatabase, type Database } from './postgres.ts';
import {
  guardMigrations,
  markerFile,
  readMarker,
  readSkippedVersion,
  skippedVersionFile,
  writeMarker,
  writeSkippedVersion,
  type MigrationGuardEffects,
} from './update-migration.ts';

const CLUSTER_START_TIMEOUT = 60_000;
let tools: DumpTools | null = null;
let clusterDir: string | undefined;
let cluster: Database | undefined;

beforeAll(async () => {
  tools = await findDumpTools(DUMP_TOOL_DIRS);
  if (!tools) return;
  clusterDir = await mkdtemp(path.join(tmpdir(), 'spark-update-cluster-'));
  cluster = await startDatabase({
    dataDir: path.join(clusterDir, 'data'),
    passwordFile: path.join(clusterDir, 'password'),
    port: await freePort(),
    log: () => undefined,
  });
}, CLUSTER_START_TIMEOUT);

afterAll(async () => {
  await cluster?.stop();
  if (clusterDir) await rm(clusterDir, { recursive: true, force: true });
}, CLUSTER_START_TIMEOUT);

async function onServer(work: (client: pg.Client) => Promise<unknown>): Promise<void> {
  const admin = new URL(cluster!.url);
  admin.pathname = '/postgres';
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    await work(client);
  } finally {
    await client.end();
  }
}

async function query<T extends pg.QueryResultRow>(url: string, sql: string): Promise<T[]> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return (await client.query<T>(sql)).rows;
  } finally {
    await client.end();
  }
}

describe('update migration with a pg_dump backup', () => {
  let work: string;
  let migrations: string;
  let userData: string;
  let databaseUrl: string;

  beforeEach(async (context) => {
    if (!tools) context.skip();
    work = await mkdtemp(path.join(tmpdir(), 'spark-update-'));
    migrations = path.join(work, 'migrations');
    userData = path.join(work, 'Spark Outpost');
    await mkdir(migrations);
    const url = new URL(cluster!.url);
    const databaseName = `${url.pathname.slice(1)}_update_${randomUUID().slice(0, 8)}`;
    url.pathname = `/${databaseName}`;
    databaseUrl = url.toString();
    await onServer((client) => client.query(`CREATE DATABASE ${databaseName}`));
    await writeFile(
      path.join(migrations, '0001_notes.sql'),
      "CREATE TABLE notes (id int PRIMARY KEY, body text); INSERT INTO notes VALUES (1, 'kept');",
    );
    await migrate();
  });

  afterEach(async () => {
    if (work) await rm(work, { recursive: true, force: true });
  });

  async function migrate() {
    const db = createDb(databaseUrl, { max: 1 });
    try {
      await runMigrations(db, { dir: migrations });
      return { ok: true as const };
    } catch (error) {
      return { ok: false as const, detail: (error as Error).message };
    } finally {
      await db.end();
    }
  }

  function effects(): MigrationGuardEffects {
    const backups = path.join(userData, 'backups');
    return {
      pending: () => pendingMigrations(databaseUrl, migrations),
      backup: (previous) =>
        dumpDatabase(
          tools!,
          databaseUrl,
          path.join(backups, `${backupName(previous ?? 'unknown', new Date())}.dump`),
        ),
      rotate: async () => {
        await rotateBackups(backups);
      },
      migrate,
      restore: (backup) => restoreDump(tools!, databaseUrl, backup.path),
      readMarker: () => readMarker(markerFile(userData)),
      writeMarker: (marker) => writeMarker(markerFile(userData), marker),
      recordFailure: (version) => writeSkippedVersion(skippedVersionFile(userData), version),
      now: () => new Date(),
    };
  }

  it('restores the database exactly as it was when a migration fails part way', async () => {
    await writeMarker(markerFile(userData), { version: '0.1.0', migratedAt: 'earlier' });
    await writeFile(
      path.join(migrations, '0002_tags.sql'),
      "CREATE TABLE tags (id int PRIMARY KEY); UPDATE notes SET body = 'changed';",
    );
    await writeFile(
      path.join(migrations, '0003_broken.sql'),
      'CREATE TABLE broken (id int REFERENCES missing(id));',
    );

    const result = await guardMigrations('0.2.0', effects());

    expect(result).toMatchObject({ status: 'restored', previousVersion: '0.1.0' });
    expect(result.status === 'restored' && result.detail).toMatch(/0003_broken\.sql failed/);
    expect(await query(databaseUrl, 'SELECT id, body FROM notes')).toEqual([
      { id: 1, body: 'kept' },
    ]);
    expect(await query(databaseUrl, "SELECT to_regclass('tags') AS tags")).toEqual([
      { tags: null },
    ]);
    expect(await query(databaseUrl, 'SELECT name FROM schema_migrations')).toEqual([
      { name: '0001_notes.sql' },
    ]);
    expect(await readMarker(markerFile(userData))).toMatchObject({ version: '0.1.0' });
    expect(await readSkippedVersion(skippedVersionFile(userData))).toBe('0.2.0');
  });

  it('migrates after a backup, records the version and keeps the last three backups', async () => {
    for (const [index, version] of ['0.2.0', '0.3.0', '0.4.0', '0.5.0'].entries()) {
      await writeFile(
        path.join(migrations, `000${index + 2}_step.sql`),
        `CREATE TABLE step_${index} (id int);`,
      );
      expect(await guardMigrations(version, effects())).toMatchObject({ status: 'migrated' });
    }

    expect(await readMarker(markerFile(userData))).toMatchObject({ version: '0.5.0' });
    const kept = await readdir(path.join(userData, 'backups'));
    expect(kept).toHaveLength(3);
    expect(kept.every((name) => name.endsWith('.dump'))).toBe(true);
  });
});
