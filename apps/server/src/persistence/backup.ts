import { execFile } from 'node:child_process';
import { access, constants, mkdir, readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { migrationsDir } from './migrate.ts';

const execFileAsync = promisify(execFile);

const defaultBackupDir = path.resolve(migrationsDir, '../../../.local/backups');
const BACKUPS_KEPT = 5;

const HOMEBREW_CANDIDATES = ['brew', '/opt/homebrew/bin/brew', '/usr/local/bin/brew'];
const POSTGRES_FORMULA = 'postgresql@17';

async function isExecutable(file: string): Promise<boolean> {
  try {
    await access(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function homebrewPgDump(): Promise<string | null> {
  for (const brew of HOMEBREW_CANDIDATES) {
    try {
      const { stdout } = await execFileAsync(brew, ['--prefix', POSTGRES_FORMULA]);
      const candidate = path.join(stdout.trim(), 'bin', 'pg_dump');
      if (await isExecutable(candidate)) return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

async function pathPgDump(): Promise<string | null> {
  for (const dir of (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(dir, 'pg_dump');
    if (await isExecutable(candidate)) return candidate;
  }
  return null;
}

async function findPgDump(): Promise<string> {
  const found = (await homebrewPgDump()) ?? (await pathPgDump());
  if (!found) {
    throw new Error(`pg_dump was not found. Install it with: brew install ${POSTGRES_FORMULA}`);
  }
  return found;
}

export interface BackupOptions {
  databaseUrl: string;
  dir?: string;
  keep?: number;
  pgDump?: string;
  now?: () => Date;
}

function timestamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

export async function backupDatabase(options: BackupOptions): Promise<string> {
  const {
    databaseUrl,
    dir = defaultBackupDir,
    keep = BACKUPS_KEPT,
    now = () => new Date(),
  } = options;
  const pgDump = options.pgDump ?? (await findPgDump());
  const url = new URL(databaseUrl);
  const password = decodeURIComponent(url.password);
  url.password = '';
  const database = decodeURIComponent(url.pathname.slice(1));
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, `${database}-${timestamp(now())}.dump`);
  const partial = `${file}.partial`;
  try {
    await execFileAsync(
      pgDump,
      ['--format=custom', `--file=${partial}`, `--dbname=${url.toString()}`],
      {
        env: { ...process.env, PGPASSWORD: password },
      },
    );
  } catch (error) {
    await rm(partial, { force: true });
    const detail = (error as { stderr?: string }).stderr?.trim() || (error as Error).message;
    throw new Error(`Database backup with pg_dump failed: ${detail}`, { cause: error });
  }
  await rename(partial, file);
  await pruneBackups(dir, database, keep);
  return file;
}

async function pruneBackups(dir: string, database: string, keep: number): Promise<void> {
  const backups = (await readdir(dir))
    .filter((name) => name.startsWith(`${database}-`) && name.endsWith('.dump'))
    .sort()
    .reverse();
  for (const name of backups.slice(keep)) await rm(path.join(dir, name));
}
