import type { ChildProcess } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createLaunchToken } from '../../../apps/server/src/api/launch-token.ts';
import type { Db } from '../../../apps/server/src/persistence/db.ts';
import { API_TOKEN_ENV } from '../../../packages/contracts/src/index.ts';
import { FAKE_ACP_MODELS, slotPorts } from '../../../tests/browser/stub-config.ts';
import { WORKTREE_ROOT } from '../paths.ts';
import { Api } from './api.ts';
import { createThrowawaySchema, type ThrowawaySchema } from './database.ts';
import { startProcess, stopProcess, waitUntil } from './processes.ts';

export const DEFAULT_PORT_SLOT = 17;
export const DRY_RUN_KEY = 'turn-tasks-dry-run-key';
const SERVER = join(WORKTREE_ROOT, 'apps', 'server');
const FAKE_AGENT = join(SERVER, 'test', 'fake-acp-agent.ts');
const TSX = ['--import', 'tsx'];

export interface StackOptions {
  live: boolean;
  dir: string;
  slot: number;
}

export interface Stack {
  api: Api;
  db: Db;
  logs: string;
  close(): Promise<void>;
}

export function portSlot(env: NodeJS.ProcessEnv = process.env): number {
  const slot = Number(env.SPARK_TEST_PORT_SLOT ?? DEFAULT_PORT_SLOT);
  if (!Number.isInteger(slot) || slot < 1)
    throw new Error('SPARK_TEST_PORT_SLOT must be 1 or more.');
  return slot;
}

export function stackEnv(
  options: StackOptions,
  databaseUrl: string,
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const ports = slotPorts(options.slot);
  const env: NodeJS.ProcessEnv = {
    ...base,
    DATABASE_URL: databaseUrl,
    API_PORT: String(ports.api),
    ALLOWED_ORIGINS: `http://127.0.0.1:${ports.web}`,
    AGENT_RUNTIME: options.live ? 'acp' : 'fake',
  };
  delete env.TEST_DATABASE_URL;
  delete env.BACKUP_DIR;
  if (options.live) return env;
  return {
    ...env,
    SECRET_STORE: 'memory',
    MEMORY_SECRETS: JSON.stringify({ zai: DRY_RUN_KEY }),
    FAKE_ACP_AGENT: FAKE_AGENT,
    FAKE_ACP_MODELS: JSON.stringify(FAKE_ACP_MODELS),
  };
}

async function migrate(env: NodeJS.ProcessEnv, logs: string): Promise<void> {
  const cli = startProcess({
    name: 'migrate',
    args: [...TSX, 'src/persistence/migrate-cli.ts'],
    cwd: SERVER,
    env,
    logs,
  });
  const code = await cli.exited;
  if (code !== 0) throw new Error(`Migrations failed: ${cli.output().slice(-500)}`);
}

async function startServers(
  env: NodeJS.ProcessEnv,
  api: Api,
  token: string,
  logs: string,
  started: ChildProcess[],
): Promise<void> {
  const apiEnv = { ...env, [API_TOKEN_ENV]: token };
  const server = startProcess({
    name: 'api',
    args: [...TSX, 'src/api/main.ts'],
    cwd: SERVER,
    env: apiEnv,
    logs,
  });
  started.push(server.child);
  await waitUntil(() => api.healthy(), 'The API');
  const worker = startProcess({
    name: 'worker',
    args: [...TSX, 'src/workflow/main.ts'],
    cwd: SERVER,
    env,
    logs,
  });
  started.push(worker.child);
  await waitUntil(async () => /Worker running/.test(worker.output()), 'The worker');
}

async function shutDown(started: ChildProcess[], schema: ThrowawaySchema): Promise<void> {
  for (const child of [...started].reverse()) await stopProcess(child);
  await schema.drop();
}

export async function startStack(options: StackOptions): Promise<Stack> {
  const logs = join(options.dir, 'logs');
  await mkdir(logs, { recursive: true });
  const schema = await createThrowawaySchema();
  const started: ChildProcess[] = [];
  try {
    const env = stackEnv(options, schema.url);
    await migrate(env, logs);
    const token = createLaunchToken();
    const api = new Api(`http://127.0.0.1:${slotPorts(options.slot).api}/api`, token);
    await startServers(env, api, token, logs, started);
    return { api, db: schema.db, logs, close: () => shutDown(started, schema) };
  } catch (error) {
    await shutDown(started, schema);
    throw error;
  }
}
