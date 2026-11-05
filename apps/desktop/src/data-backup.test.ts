import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  backupName,
  copyDataDir,
  findDumpTools,
  restoreDataDir,
  rotateBackups,
} from './data-backup.ts';

let work: string;

beforeEach(async () => {
  work = await mkdtemp(path.join(tmpdir(), 'spark-backup-'));
});

afterEach(async () => {
  await rm(work, { recursive: true, force: true });
});

async function fakeTool(dir: string, name: string, version: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, name);
  await writeFile(file, `#!/bin/sh\necho "${name} (PostgreSQL) ${version}"\n`);
  await chmod(file, 0o755);
}

describe('rotateBackups', () => {
  it('keeps the newest three update backups, dumps and folder copies alike', async () => {
    const backups = path.join(work, 'backups');
    await mkdir(backups);
    const names = [1, 2, 3, 4, 5].map((day) =>
      backupName('0.1.0', new Date(Date.UTC(2026, 8, day))),
    );
    await writeFile(path.join(backups, `${names[0]}.dump`), '');
    await mkdir(path.join(backups, names[1]!));
    await writeFile(path.join(backups, `${names[2]}.dump`), '');
    await mkdir(path.join(backups, names[3]!));
    await writeFile(path.join(backups, `${names[4]}.dump`), '');
    await writeFile(path.join(backups, 'spark_outpost-2026-01-01.dump'), '');
    await mkdir(path.join(backups, `${names[4]}-later.partial`));

    await rotateBackups(backups);

    expect((await readdir(backups)).sort()).toEqual(
      [
        names[2] + '.dump',
        names[3],
        names[4] + '.dump',
        `${names[4]}-later.partial`,
        'spark_outpost-2026-01-01.dump',
      ].sort(),
    );
  });

  it('does nothing when there is no backups folder yet', async () => {
    expect(await rotateBackups(path.join(work, 'missing'))).toEqual([]);
  });
});

describe('data folder copies', () => {
  it('copies the stopped data folder without the pid file and restores it, keeping the failed copy', async () => {
    const data = path.join(work, 'postgres');
    await mkdir(path.join(data, 'base'), { recursive: true });
    await writeFile(path.join(data, 'PG_VERSION'), '17\n');
    await writeFile(path.join(data, 'base/1'), 'before');
    await writeFile(path.join(data, 'postmaster.pid'), '123');
    const target = path.join(work, 'backups', 'update-x');

    expect(await copyDataDir(data, target)).toEqual({ kind: 'copy', path: target });
    expect((await readdir(target)).sort()).toEqual(['PG_VERSION', 'base']);

    await writeFile(path.join(data, 'base/1'), 'half migrated');
    const failed = path.join(work, 'postgres-failed-update');
    await restoreDataDir(target, data, failed);

    expect(await readFile(path.join(data, 'base/1'), 'utf8')).toBe('before');
    expect(await readFile(path.join(failed, 'base/1'), 'utf8')).toBe('half migrated');
    expect(await readFile(path.join(target, 'base/1'), 'utf8')).toBe('before');
  });
});

describe('findDumpTools', { timeout: 20_000 }, () => {
  it('uses the first folder with pg_dump and pg_restore from Postgres 17', async () => {
    const old = path.join(work, 'pg16');
    const partial = path.join(work, 'dump-only');
    const good = path.join(work, 'pg17');
    await fakeTool(old, 'pg_dump', '16.4');
    await fakeTool(old, 'pg_restore', '16.4');
    await fakeTool(partial, 'pg_dump', '17.2');
    await fakeTool(good, 'pg_dump', '17.6 (Homebrew)');
    await fakeTool(good, 'pg_restore', '17.6 (Homebrew)');

    expect(await findDumpTools([path.join(work, 'none'), old, partial, good])).toEqual({
      pgDump: path.join(good, 'pg_dump'),
      pgRestore: path.join(good, 'pg_restore'),
    });
  });

  it('falls back to a folder copy when no matching tools exist', async () => {
    await fakeTool(path.join(work, 'pg16'), 'pg_dump', '16.4');
    expect(await findDumpTools([path.join(work, 'pg16')])).toBeNull();
  });
});
