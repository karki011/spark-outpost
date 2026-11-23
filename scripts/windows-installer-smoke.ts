import { execFile, spawn } from 'node:child_process';
import { appendFile, glob, mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { startWithPgCtl } from '../apps/desktop/src/postgres-windows.ts';

interface Result {
  name: string;
  ok: boolean;
  required: boolean;
  detail: string;
}

const runFile = promisify(execFile);
const PROGRAMS = path.join(process.env.LOCALAPPDATA ?? '', 'Programs');
const INSTALL_ROOT = path.join(PROGRAMS, 'spark-outpost');
const APP_EXE = path.join(INSTALL_ROOT, 'Spark Outpost.exe');
const UNINSTALLER = path.join(INSTALL_ROOT, 'Uninstall Spark Outpost.exe');
const POSTGRES_BIN = path.join(
  INSTALL_ROOT,
  'resources/app/node_modules/@embedded-postgres/windows-x64/native/bin',
);
const LAUNCH_WAIT_MS = 120_000;
const results: Result[] = [];

async function check(name: string, required: boolean, run: () => Promise<string>): Promise<void> {
  try {
    results.push({ name, ok: true, required, detail: await run() });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    results.push({ name, ok: false, required, detail });
  }
}

async function installer(): Promise<string> {
  const found: string[] = [];
  for await (const file of glob('apps/desktop/release/*/Spark-Outpost-*-x64.exe')) found.push(file);
  if (found.length !== 1) throw new Error(`expected one installer, found ${found.length}`);
  return path.resolve(found[0]!);
}

async function exists(file: string): Promise<string> {
  const info = await stat(file);
  return `${path.basename(file)} (${Math.round(info.size / 1024)} KB)`;
}

async function install(): Promise<string> {
  const file = await installer();
  const size = Math.round((await stat(file)).size / 1024 / 1024);
  await runFile(file, ['/S'], { timeout: 300_000 });
  await stat(APP_EXE).catch(async () => {
    const programs = await readdir(PROGRAMS).catch(() => []);
    throw new Error(`no ${APP_EXE}; ${PROGRAMS} holds: ${programs.join(', ')}`);
  });
  return `${path.basename(file)} (${size} MB) installed to ${INSTALL_ROOT}`;
}

async function installedPostgres(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'spark-installed-pg-'));
  const dataDir = path.join(dir, 'data');
  try {
    await runFile(path.join(POSTGRES_BIN, 'initdb.exe'), [
      '-D',
      dataDir,
      '-U',
      'spark',
      '--auth=trust',
      '-E',
      'UTF8',
    ]);
    const stop = await startWithPgCtl({
      pgCtl: path.join(POSTGRES_BIN, 'pg_ctl.exe'),
      dataDir,
      port: 54_329,
      host: '127.0.0.1',
      log: (line) => console.log(line),
    });
    await stop();
    return 'initdb, then pg_ctl start and stop, from the installed files';
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function logTail(dataRoot: string): Promise<string> {
  const logs = path.join(dataRoot, 'Spark Outpost', 'logs');
  const names = await readdir(logs).catch(() => []);
  const tails: string[] = [];
  for (const name of names) {
    const text = await readFile(path.join(logs, name), 'utf8').catch(() => '');
    tails.push(`${name}:\n${text.trim().split(/\r?\n/).slice(-15).join('\n')}`);
  }
  return tails.join('\n\n');
}

async function launch(): Promise<string> {
  const dataRoot = await mkdtemp(path.join(tmpdir(), 'spark-app-data-'));
  const child = spawn(APP_EXE, [], {
    env: { ...process.env, SPARK_APP_DATA: dataRoot },
    stdio: 'ignore',
  });
  let exitCode: number | null = null;
  child.once('exit', (code) => {
    exitCode = code ?? -1;
  });
  const started = Date.now();
  let database = false;
  while (Date.now() - started < LAUNCH_WAIT_MS && exitCode === null && !database) {
    await delay(2_000);
    database = await stat(path.join(dataRoot, 'Spark Outpost', 'postgres', 'PG_VERSION'))
      .then(() => true)
      .catch(() => false);
  }
  await delay(10_000);
  const alive = exitCode === null;
  if (child.pid) await runFile('taskkill', ['/PID', String(child.pid), '/T', '/F']).catch(() => {});
  await delay(3_000);
  const tail = await logTail(dataRoot);
  console.log(tail);
  if (!database) throw new Error(`no database after ${LAUNCH_WAIT_MS / 1000}s\n${tail}`);
  if (!alive) throw new Error(`the app exited with ${exitCode}\n${tail}`);
  return 'the installed app started and made its database';
}

async function uninstall(): Promise<string> {
  await runFile(UNINSTALLER, ['/S'], { timeout: 120_000 });
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const left = await stat(APP_EXE).then(
      () => true,
      () => false,
    );
    if (!left) return 'removed';
    await delay(1_000);
  }
  throw new Error(`${APP_EXE} is still there`);
}

await check('Install silently', true, install);
await check('App executable', true, () => exists(APP_EXE));
await check('pg_ctl in the installed app', true, () =>
  exists(path.join(POSTGRES_BIN, 'pg_ctl.exe')),
);
await check('Postgres from the installed files', true, installedPostgres);
await check('Launch the installed app', false, launch);
await check('Uninstall silently', true, uninstall);

const lines = [
  '## Windows installer',
  '',
  '| Check | Result | Detail |',
  '| --- | --- | --- |',
  ...results.map((result) => {
    const mark = result.ok ? 'pass' : result.required ? 'FAIL' : 'fail (not required yet)';
    const detail = result.detail.split(/\r?\n/)[0]!.replaceAll('|', '\\|');
    return `| ${result.name} | ${mark} | ${detail} |`;
  }),
  '',
];
console.log(lines.join('\n'));
if (process.env.GITHUB_STEP_SUMMARY)
  await appendFile(process.env.GITHUB_STEP_SUMMARY, lines.join('\n'));
process.exit(results.some((result) => result.required && !result.ok) ? 1 : 0);
