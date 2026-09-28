import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import pg from 'pg';
import { LOOPBACK } from './ports.ts';

const run = promisify(execFile);

export const DATABASE_NAME = 'spark_outpost';
const USER = 'spark';
const STALE_STOP_TIMEOUT_MS = 15_000;
const EXIT_EVENTS = ['exit', 'beforeExit', 'SIGHUP', 'SIGINT', 'SIGTERM', 'SIGBREAK', 'message'];
const processEvents: NodeJS.EventEmitter = process;

async function loadWithoutExitHooks() {
  const before = new Map(EXIT_EVENTS.map((event) => [event, processEvents.listeners(event)]));
  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  for (const event of EXIT_EVENTS) {
    for (const listener of processEvents.listeners(event)) {
      if (!before.get(event)?.includes(listener)) {
        processEvents.removeListener(event, listener as (...args: unknown[]) => void);
      }
    }
  }
  return EmbeddedPostgres;
}

export interface DatabaseOptions {
  dataDir: string;
  passwordFile: string;
  port: number;
  log: (line: string) => void;
}

export interface Database {
  url: string;
  stop(): Promise<void>;
}

async function channelPassword(file: string): Promise<string> {
  try {
    return (await readFile(file, 'utf8')).trim();
  } catch {
    const password = randomBytes(24).toString('base64url');
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    await writeFile(file, password, { mode: 0o600, flag: 'wx' });
    return password;
  }
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function isPostgres(pid: number): Promise<boolean> {
  try {
    const { stdout } = await run('ps', ['-p', String(pid), '-o', 'comm=']);
    return path.basename(stdout.trim()) === 'postgres';
  } catch {
    return false;
  }
}

async function stopLeftoverServer(dataDir: string, log: (line: string) => void): Promise<void> {
  const pidFile = path.join(dataDir, 'postmaster.pid');
  if (!existsSync(pidFile)) return;
  const pid = Number((await readFile(pidFile, 'utf8')).split('\n')[0]);
  if (!Number.isInteger(pid) || !isRunning(pid) || !(await isPostgres(pid))) return;
  log(`Stopping Postgres ${pid} left running by an earlier launch.`);
  process.kill(pid, 'SIGINT');
  const deadline = Date.now() + STALE_STOP_TIMEOUT_MS;
  while (isRunning(pid) && Date.now() < deadline) await delay(200);
}

async function ensureDatabase(url: string): Promise<void> {
  const admin = new URL(url);
  admin.pathname = '/postgres';
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      DATABASE_NAME,
    ]);
    if (rowCount === 0) await client.query(`CREATE DATABASE ${DATABASE_NAME}`);
  } finally {
    await client.end();
  }
}

export async function startDatabase(options: DatabaseOptions): Promise<Database> {
  const { dataDir, port, log } = options;
  const password = await channelPassword(options.passwordFile);
  const EmbeddedPostgres = await loadWithoutExitHooks();
  const server = new EmbeddedPostgres({
    databaseDir: dataDir,
    port,
    user: USER,
    password,
    authMethod: 'scram-sha-256',
    persistent: true,
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    postgresFlags: ['-c', `listen_addresses=${LOOPBACK}`, '-c', 'unix_socket_directories='],
    onLog: (message) => log(String(message).trimEnd()),
    onError: (error) => log(String(error)),
  });
  if (!existsSync(path.join(dataDir, 'PG_VERSION'))) {
    log(`Creating the database cluster in ${dataDir}.`);
    await server.initialise();
  } else {
    await stopLeftoverServer(dataDir, log);
  }
  try {
    await server.start();
  } catch (error) {
    throw new Error(
      `Postgres did not start: ${(error as Error | undefined)?.message ?? 'it exited during startup'}. See the log above.`,
      { cause: error },
    );
  }
  const url = `postgres://${USER}:${encodeURIComponent(password)}@${LOOPBACK}:${port}/${DATABASE_NAME}`;
  await ensureDatabase(url);
  return { url, stop: () => server.stop() };
}
