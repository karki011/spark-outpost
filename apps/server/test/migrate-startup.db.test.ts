import { randomUUID } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { backupDatabase } from '../src/persistence/backup.ts';
import { createDb, POOL_MAX, type Db } from '../src/persistence/db.ts';
import { migrateAtStartup } from '../src/persistence/migrate-startup.ts';
import { testDatabaseUrl } from './support.ts';

const FAKE_PG_DUMP = `#!/bin/sh
for arg in "$@"; do
  case "$arg" in
    --file=*) out="\${arg#--file=}" ;;
  esac
done
printf '%s\\n' "$*" > "$out"
printf 'password=%s\\n' "$PGPASSWORD" >> "$out"
`;

async function admin(sql: string): Promise<void> {
  const client = new pg.Client({ connectionString: testDatabaseUrl() });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

let schema: string;
let work: string;
let migrations: string;
let backups: string;
const pools: Db[] = [];

function openDb(): Db {
  const db = createDb(testDatabaseUrl(), { searchPath: schema, max: POOL_MAX.test });
  pools.push(db);
  return db;
}

async function addMigration(name: string, sql: string): Promise<void> {
  await writeFile(path.join(migrations, name), sql);
}

async function tableExists(db: Db, table: string): Promise<boolean> {
  const { rows } = await db.query<{ exists: boolean }>(
    'SELECT to_regclass($1) IS NOT NULL AS exists',
    [table],
  );
  return rows[0]?.exists ?? false;
}

async function appliedNames(db: Db): Promise<string[]> {
  const { rows } = await db.query<{ name: string }>(
    'SELECT name FROM schema_migrations ORDER BY name',
  );
  return rows.map((row) => row.name);
}

beforeEach(async () => {
  schema = `test_${randomUUID().replaceAll('-', '')}`;
  await admin(`CREATE SCHEMA ${schema}`);
  work = await mkdtemp(path.join(tmpdir(), 'spark-migrate-'));
  migrations = path.join(work, 'migrations');
  backups = path.join(work, 'backups');
  await mkdir(migrations);
  await addMigration('0001_notes.sql', 'CREATE TABLE notes (id int PRIMARY KEY);');
  await migrateAtStartup(openDb(), { dir: migrations, backup: async () => 'unused' });
});

afterEach(async () => {
  await Promise.all(pools.splice(0).map((db) => db.end()));
  await admin(`DROP SCHEMA ${schema} CASCADE`);
  await rm(work, { recursive: true, force: true });
});

describe('migrateAtStartup', () => {
  it('lets one of two concurrent processes apply pending migrations while the other waits', async () => {
    await addMigration(
      '0002_slow.sql',
      'SELECT pg_sleep(0.3); CREATE TABLE slow_items (id int PRIMARY KEY);',
    );
    let backupCalls = 0;
    const backup = async () => {
      backupCalls += 1;
      return path.join(backups, 'one.dump');
    };

    const [first, second] = await Promise.all([
      migrateAtStartup(openDb(), { dir: migrations, backup }),
      migrateAtStartup(openDb(), { dir: migrations, backup }),
    ]);

    expect([first.applied, second.applied]).toEqual(
      expect.arrayContaining([['0002_slow.sql'], []]),
    );
    expect(backupCalls).toBe(1);
    expect(await appliedNames(openDb())).toEqual(['0001_notes.sql', '0002_slow.sql']);
  });

  it('backs up the database before applying pending migrations', async () => {
    await addMigration('0002_tags.sql', 'CREATE TABLE tags (id int PRIMARY KEY);');
    const db = openDb();
    let tagsExistedAtBackup: boolean | null = null;

    const result = await migrateAtStartup(db, {
      dir: migrations,
      backup: async () => {
        tagsExistedAtBackup = await tableExists(db, 'tags');
        return '/backups/before.dump';
      },
    });

    expect(tagsExistedAtBackup).toBe(false);
    expect(result).toEqual({ applied: ['0002_tags.sql'], backupPath: '/backups/before.dump' });
    expect(await tableExists(db, 'tags')).toBe(true);
  });

  it('applies pending migrations without a backup when none is configured', async () => {
    await addMigration('0002_tags.sql', 'CREATE TABLE tags (id int PRIMARY KEY);');
    const db = openDb();

    const result = await migrateAtStartup(db, { dir: migrations });

    expect(result).toEqual({ applied: ['0002_tags.sql'], backupPath: null });
    expect(await tableExists(db, 'tags')).toBe(true);
  });

  it('skips the backup when nothing is pending', async () => {
    let backupCalls = 0;
    const result = await migrateAtStartup(openDb(), {
      dir: migrations,
      backup: async () => {
        backupCalls += 1;
        return 'unused';
      },
    });

    expect(result).toEqual({ applied: [], backupPath: null });
    expect(backupCalls).toBe(0);
  });

  it('stops with the failing migration and the backup path, keeping earlier work', async () => {
    await addMigration('0002_tags.sql', 'CREATE TABLE tags (id int PRIMARY KEY);');
    await addMigration('0003_broken.sql', 'CREATE TABLE broken (id int REFERENCES missing(id));');
    const db = openDb();

    await expect(
      migrateAtStartup(db, { dir: migrations, backup: async () => '/backups/before.dump' }),
    ).rejects.toThrow(
      /Migration 0003_broken\.sql failed: .*missing.*The backup taken before migrating is at \/backups\/before\.dump\./,
    );
    expect(await appliedNames(db)).toEqual(['0001_notes.sql', '0002_tags.sql']);
    expect(await tableExists(db, 'broken')).toBe(false);
  });

  it('applies nothing when the backup fails', async () => {
    await addMigration('0002_tags.sql', 'CREATE TABLE tags (id int PRIMARY KEY);');
    const db = openDb();

    await expect(
      migrateAtStartup(db, {
        dir: migrations,
        backup: async () => {
          throw new Error('disk full');
        },
      }),
    ).rejects.toThrow(
      'Could not back up the database before applying 0002_tags.sql; no migrations were applied. disk full',
    );
    expect(await appliedNames(db)).toEqual(['0001_notes.sql']);
  });
});

describe('backupDatabase', () => {
  let pgDump: string;

  beforeEach(async () => {
    pgDump = path.join(work, 'pg_dump');
    await writeFile(pgDump, FAKE_PG_DUMP);
    await chmod(pgDump, 0o755);
  });

  it('writes a custom-format dump without putting the password on the command line', async () => {
    const file = await backupDatabase({
      databaseUrl: 'postgres://spark:s3cret@127.0.0.1:54329/spark_outpost',
      dir: backups,
      pgDump,
      now: () => new Date('2026-09-27T10:00:00.000Z'),
    });

    expect(file).toBe(path.join(backups, 'spark_outpost-2026-09-27T10-00-00-000Z.dump'));
    const [args, password] = (await readFile(file, 'utf8')).trim().split('\n');
    expect(args).toContain('--format=custom');
    expect(args).toContain('--dbname=postgres://spark@127.0.0.1:54329/spark_outpost');
    expect(args).not.toContain('s3cret');
    expect(password).toBe('password=s3cret');
  });

  it('keeps only the newest five backups of the database', async () => {
    for (let minute = 0; minute < 7; minute += 1) {
      await backupDatabase({
        databaseUrl: 'postgres://spark:pw@127.0.0.1:54329/spark_outpost',
        dir: backups,
        pgDump,
        now: () => new Date(Date.UTC(2026, 8, 27, 10, minute)),
      });
    }

    const kept = (await readdir(backups)).sort();
    expect(kept).toHaveLength(5);
    expect(kept[0]).toBe('spark_outpost-2026-09-27T10-02-00-000Z.dump');
  });

  it('reports a pg_dump failure and leaves no partial file', async () => {
    const failing = path.join(work, 'failing_pg_dump');
    await writeFile(failing, '#!/bin/sh\necho "connection refused" >&2\nexit 1\n');
    await chmod(failing, 0o755);

    await expect(
      backupDatabase({
        databaseUrl: 'postgres://spark:pw@127.0.0.1:54329/spark_outpost',
        dir: backups,
        pgDump: failing,
      }),
    ).rejects.toThrow('Database backup with pg_dump failed: connection refused');
    expect(await readdir(backups)).toEqual([]);
  });
});
