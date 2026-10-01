import { execFile } from 'node:child_process';
import { access, constants, cp, mkdir, readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import pg from 'pg';

const run = promisify(execFile);

export const BACKUPS_KEPT = 3;
const POSTGRES_MAJOR = 17;
const BACKUP_PREFIX = 'update-';

export interface DumpTools {
  pgDump: string;
  pgRestore: string;
}

export type Backup = { kind: 'dump'; path: string } | { kind: 'copy'; path: string };

export const DUMP_TOOL_DIRS = [
  '/opt/homebrew/opt/postgresql@17/bin',
  '/usr/local/opt/postgresql@17/bin',
];

async function isExecutable(file: string): Promise<boolean> {
  try {
    await access(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function majorVersion(tool: string): Promise<number | null> {
  try {
    const { stdout } = await run(tool, ['--version']);
    const match = /(\d+)(\.\d+)?/.exec(stdout);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

export async function findDumpTools(dirs: string[]): Promise<DumpTools | null> {
  for (const dir of dirs) {
    const tools = { pgDump: path.join(dir, 'pg_dump'), pgRestore: path.join(dir, 'pg_restore') };
    if (!(await isExecutable(tools.pgDump)) || !(await isExecutable(tools.pgRestore))) continue;
    if ((await majorVersion(tools.pgDump)) !== POSTGRES_MAJOR) continue;
    if ((await majorVersion(tools.pgRestore)) !== POSTGRES_MAJOR) continue;
    return tools;
  }
  return null;
}

function timestamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

export function backupName(version: string, date: Date): string {
  return `${BACKUP_PREFIX}${timestamp(date)}-from-${version}`;
}

interface Connection {
  url: string;
  password: string;
  database: string;
}

function connection(databaseUrl: string): Connection {
  const url = new URL(databaseUrl);
  const password = decodeURIComponent(url.password);
  url.password = '';
  return { url: url.toString(), password, database: decodeURIComponent(url.pathname.slice(1)) };
}

async function runTool(tool: string, args: string[], password: string, label: string) {
  try {
    await run(tool, args, {
      env: { ...process.env, PGPASSWORD: password },
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (error) {
    const detail = (error as { stderr?: string }).stderr?.trim() || (error as Error).message;
    throw new Error(`${label} failed: ${detail}`, { cause: error });
  }
}

export async function dumpDatabase(
  tools: DumpTools,
  databaseUrl: string,
  file: string,
): Promise<Backup> {
  const { url, password } = connection(databaseUrl);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const partial = `${file}.partial`;
  try {
    await runTool(
      tools.pgDump,
      ['--format=custom', `--file=${partial}`, `--dbname=${url}`],
      password,
      'pg_dump',
    );
  } catch (error) {
    await rm(partial, { force: true });
    throw error;
  }
  await rename(partial, file);
  return { kind: 'dump', path: file };
}

async function recreateDatabase(databaseUrl: string): Promise<void> {
  const admin = new URL(databaseUrl);
  const { database } = connection(databaseUrl);
  admin.pathname = '/postgres';
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const name = client.escapeIdentifier(database);
    await client.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await client.query(`CREATE DATABASE ${name}`);
  } finally {
    await client.end();
  }
}

export async function restoreDump(
  tools: DumpTools,
  databaseUrl: string,
  file: string,
): Promise<void> {
  await recreateDatabase(databaseUrl);
  const { url, password } = connection(databaseUrl);
  await runTool(
    tools.pgRestore,
    ['--no-owner', '--exit-on-error', '--single-transaction', `--dbname=${url}`, file],
    password,
    'pg_restore',
  );
}

export async function copyDataDir(dataDir: string, target: string): Promise<Backup> {
  const partial = `${target}.partial`;
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await rm(partial, { recursive: true, force: true });
  try {
    await cp(dataDir, partial, {
      recursive: true,
      verbatimSymlinks: true,
      filter: (source) => path.basename(source) !== 'postmaster.pid',
    });
  } catch (error) {
    await rm(partial, { recursive: true, force: true });
    throw new Error(`Copying the database folder failed: ${(error as Error).message}`, {
      cause: error,
    });
  }
  await rename(partial, target);
  return { kind: 'copy', path: target };
}

export async function restoreDataDir(backup: string, dataDir: string, failed: string) {
  await rm(failed, { recursive: true, force: true });
  await rename(dataDir, failed);
  await cp(backup, dataDir, { recursive: true, verbatimSymlinks: true });
}

export async function rotateBackups(dir: string, keep = BACKUPS_KEPT): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const backups = entries
    .filter((name) => name.startsWith(BACKUP_PREFIX) && !name.endsWith('.partial'))
    .sort()
    .reverse();
  const removed = backups.slice(keep);
  for (const name of removed) await rm(path.join(dir, name), { recursive: true, force: true });
  return removed;
}
