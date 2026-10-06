import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { API_TOKEN_ENV, API_TOKEN_HEADER } from '../../packages/contracts/src/index.ts';
import { createLaunchToken } from '../../apps/server/src/api/launch-token.ts';
import { createDb, type Db } from '../../apps/server/src/persistence/db.ts';
import { FAKE_ACP_MODELS } from '../../tests/browser/stub-config.ts';
import { testDatabaseUrl } from '../test-database.ts';
import { STUB_URL, portsFor, urlsFor, type StackUrls } from './config.ts';
import type { Version } from './plan.ts';
import { seedWorkspace } from './seed.ts';

export type Runtime = 'acp' | 'fake';

export const ROOT = resolve(import.meta.dirname, '../..');

export interface Stack {
  runtime: Runtime;
  version: Version;
  appRoot: string;
  databaseUrl: string;
  cleanupSql: { url: string; sql: string };
  db: Db;
  workspaceId: string;
  urls: StackUrls;
  apiToken: string;
  processes: ChildProcess[];
  workerPid: number | null;
  logs: string;
}

async function admin(url: string, sql: string): Promise<void> {
  const db = createDb(url);
  try {
    await db.query(sql);
  } finally {
    await db.end();
  }
}

interface Target {
  url: string;
  db: Db;
  cleanupSql: { url: string; sql: string };
}

async function prepareDatabase(version: Version): Promise<Target> {
  const testUrl = testDatabaseUrl();
  if (version === 'current') {
    const schema = `e2e_live_${Date.now()}`;
    await admin(testUrl, `CREATE SCHEMA ${schema}`);
    const url = new URL(testUrl);
    url.searchParams.set('options', `-c search_path=${schema}`);
    return {
      url: url.toString(),
      db: createDb(testUrl, { searchPath: schema }),
      cleanupSql: { url: testUrl, sql: `DROP SCHEMA ${schema} CASCADE` },
    };
  }
  const name = `spark_outpost_e2e_${version}_test`;
  await admin(testUrl, `DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin(testUrl, `CREATE DATABASE ${name}`);
  const url = new URL(testUrl);
  url.pathname = `/${name}`;
  return {
    url: url.toString(),
    db: createDb(url.toString()),
    cleanupSql: { url: testUrl, sql: `DROP DATABASE IF EXISTS ${name} WITH (FORCE)` },
  };
}

export interface StackExtras {
  env?: NodeJS.ProcessEnv;
  secrets?: Record<string, string>;
  unset?: readonly string[];
}

function baseEnv(
  runtime: Runtime,
  version: Version,
  appRoot: string,
  databaseUrl: string,
  urls: StackUrls,
  extras: StackExtras = {},
) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...extras.env,
    DATABASE_URL: databaseUrl,
    API_PORT: String(urls.ports.api),
    ALLOWED_ORIGINS: urls.web,
    AGENT_RUNTIME: runtime,
  };
  delete env.TEST_DATABASE_URL;
  delete env.BACKUP_DIR;
  for (const name of extras.unset ?? []) delete env[name];
  if (runtime === 'acp') return env;
  return {
    ...env,
    SECRET_STORE: 'memory',
    MEMORY_SECRETS: JSON.stringify({
      jev: 'e2e-dry-run-jev-key',
      ...(version === 'current' ? { zai: 'e2e-dry-run-zai-key' } : {}),
      ...extras.secrets,
    }),
    FAKE_ACP_AGENT: join(appRoot, 'apps/server/test/fake-acp-agent.ts'),
    FAKE_ACP_MODELS: JSON.stringify(FAKE_ACP_MODELS),
    TYPESAFE_BASE_URL: `${STUB_URL}/typesafe`,
    ANTHROPIC_BASE_URL: `${STUB_URL}/anthropic`,
    OPENAI_BASE_URL: `${STUB_URL}/openai`,
  };
}

export function startProcess(
  name: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  logs: string,
): { child: ChildProcess; output: () => string; exited: Promise<number | null> } {
  const child = spawn(process.execPath, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const log = createWriteStream(join(logs, `${name}.log`), { flags: 'a' });
  let recent = '';
  const keep = (chunk: Buffer) => {
    log.write(chunk);
    recent = (recent + chunk.toString()).slice(-4000);
  };
  child.stdout!.on('data', keep);
  child.stderr!.on('data', keep);
  const exited = new Promise<number | null>((done) => child.once('exit', done));
  return { child, output: () => recent, exited };
}

export async function waitFor(check: () => Promise<boolean>, what: string, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check().catch(() => false)) return;
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error(`${what} did not start within ${timeoutMs / 1000} s.`);
}

export const answers =
  (url: string, headers: Record<string, string> = {}) =>
  async () =>
    (await fetch(url, { headers })).ok;

async function migrate(appRoot: string, env: NodeJS.ProcessEnv, logs: string): Promise<void> {
  const cli = startProcess(
    'migrate',
    ['--import', 'tsx', 'src/persistence/migrate-cli.ts'],
    join(appRoot, 'apps/server'),
    env,
    logs,
  );
  const code = await cli.exited;
  if (code !== 0) throw new Error(`Migrations failed: ${cli.output().slice(-500)}`);
}

export async function startStack(
  runtime: Runtime,
  version: Version,
  appRoot: string,
  dir: string,
  ui: boolean,
  extras: StackExtras = {},
): Promise<Stack> {
  const logs = join(dir, 'logs', version);
  await mkdir(logs, { recursive: true });
  const urls = urlsFor(portsFor(version));
  const target = await prepareDatabase(version);
  const env = baseEnv(runtime, version, appRoot, target.url, urls, extras);
  await migrate(appRoot, env, logs);
  const workspaceId = await seedWorkspace(target.db);
  const apiToken = createLaunchToken();
  const stack: Stack = {
    runtime,
    version,
    appRoot,
    databaseUrl: target.url,
    cleanupSql: target.cleanupSql,
    db: target.db,
    workspaceId,
    urls,
    apiToken,
    processes: [],
    workerPid: null,
    logs,
  };
  const server = join(appRoot, 'apps/server');
  const apiEnv = { ...env, [API_TOKEN_ENV]: apiToken };
  const api = startProcess('api', ['--import', 'tsx', 'src/api/main.ts'], server, apiEnv, logs);
  stack.processes.push(api.child);
  await waitFor(
    answers(`${urls.api}/health`, { [API_TOKEN_HEADER]: apiToken }),
    `The ${version} API`,
  );
  const worker = startProcess(
    'worker',
    ['--import', 'tsx', 'src/workflow/main.ts'],
    server,
    env,
    logs,
  );
  stack.processes.push(worker.child);
  stack.workerPid = worker.child.pid ?? null;
  await waitFor(async () => /Worker running/.test(worker.output()), `The ${version} worker`);
  if (ui) {
    const webEnv = {
      ...process.env,
      SPARK_WEB_PORT: String(urls.ports.web),
      SPARK_API_PORT: String(urls.ports.api),
      [API_TOKEN_ENV]: apiToken,
    };
    const web = startProcess(
      'web',
      ['node_modules/vite/bin/vite.js'],
      join(appRoot, 'apps/web'),
      webEnv,
      logs,
    );
    stack.processes.push(web.child);
    await waitFor(answers(urls.web), `The ${version} web app`);
  }
  return stack;
}

export async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((done) => child.once('exit', done));
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 8_000);
  await exited;
  clearTimeout(timer);
}

export async function stopStack(stack: Stack, keepData: boolean): Promise<void> {
  for (const child of [...stack.processes].reverse()) await stopProcess(child);
  await stack.db.end();
  if (!keepData) await admin(stack.cleanupSql.url, stack.cleanupSql.sql);
}
