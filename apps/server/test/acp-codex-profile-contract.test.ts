import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { codexConfig } from '../src/agents/acp/agents.ts';
import { prepareCodexLaunch } from '../src/agents/acp/codex-launch.ts';
import { codexPermissionProfiles } from '../src/agents/acp/codex-permissions.ts';
import { childEnvironment } from '../src/setup/environment.ts';

const MODES = Object.keys(codexPermissionProfiles());
const MISSING_TABLE = /default_permissions requires a `\[permissions\]` table/;
const REPLY_WAIT_MS = 20_000;

function bundledCodex(): string | null {
  try {
    const require = createRequire(import.meta.url);
    const acpManifest = require.resolve('@agentclientprotocol/codex-acp/package.json');
    const codexManifest = createRequire(acpManifest).resolve('@openai/codex/package.json');
    return join(dirname(codexManifest), 'bin', 'codex.js');
  } catch {
    return null;
  }
}

interface Reply {
  result?: { thread?: { id: string } };
  error?: { message: string };
}

interface AppServer {
  call(method: string, params: unknown): Promise<Reply>;
  stop(): Promise<void>;
}

function startAppServer(command: string, home: string): AppServer {
  const child: ChildProcessWithoutNullStreams = spawn(command, ['app-server'], {
    env: { ...childEnvironment(process.env), CODEX_HOME: home },
  });
  const waiting = new Map<number, (reply: Reply) => void>();
  createInterface({ input: child.stdout }).on('line', (line) => {
    const message = JSON.parse(line) as Reply & { id?: number };
    if (message.id !== undefined) waiting.get(message.id)?.(message);
  });
  let next = 0;
  const send = (message: object) => child.stdin.write(`${JSON.stringify(message)}\n`);
  return {
    call(method, params) {
      next += 1;
      const id = next;
      send({ jsonrpc: '2.0', id, method, params });
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${method} got no reply`)), REPLY_WAIT_MS);
        waiting.set(id, (reply) => {
          clearTimeout(timer);
          resolve(reply);
        });
      });
    },
    stop: () =>
      new Promise((resolve) => {
        if (child.exitCode !== null) return resolve();
        child.once('exit', () => resolve());
        child.stdin.end();
        child.kill();
      }),
  };
}

const codexScript = bundledCodex();
let dir: string;
let project: string;
let codexPath: string;
const servers: AppServer[] = [];

async function open(legacy: boolean): Promise<AppServer> {
  const launchDir = await mkdtemp(join(dir, 'launch-'));
  const launch = await prepareCodexLaunch({ CODEX_PATH: codexPath }, launchDir, legacy);
  const server = startAppServer(launch.cli.CODEX_PATH!, join(dir, 'home'));
  servers.push(server);
  await server.call('initialize', {
    clientInfo: { name: 'spark-outpost-test', title: 'Spark Outpost test', version: '0.0.0' },
    capabilities: { experimentalApi: true },
  });
  return server;
}

async function selects(server: AppServer, threadId: string, mode: string): Promise<Reply> {
  return server.call('thread/settings/update', { threadId, permissions: mode });
}

describe.skipIf(codexScript === null || process.platform === 'win32')(
  'Codex accepts the permission profiles Spark launches it with',
  { timeout: 90_000 },
  () => {
    beforeAll(async () => {
      dir = await realpath(await mkdtemp(join(tmpdir(), 'spark-codex-contract-')));
      project = join(dir, 'project');
      await mkdir(project);
      await mkdir(join(dir, 'home'));
      codexPath = join(dir, 'codex');
      await writeFile(codexPath, `#!/bin/sh\nexec node '${codexScript}' "$@"\n`);
      await chmod(codexPath, 0o755);
    });

    afterAll(async () => {
      await Promise.all(servers.map((server) => server.stop()));
      await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    });

    it('selects every mode profile on a thread started with the session config', async () => {
      const server = await open(false);
      const started = await server.call('thread/start', {
        cwd: project,
        config: codexConfig(false, null, true),
      });
      expect(started.error).toBeUndefined();
      for (const mode of MODES) {
        expect((await selects(server, started.result!.thread!.id, mode)).error).toBeUndefined();
      }
    });

    it('selects every mode profile on a thread that got no session config', async () => {
      const server = await open(false);
      const started = await server.call('thread/start', { cwd: project });
      expect(started.error).toBeUndefined();
      for (const mode of MODES) {
        expect((await selects(server, started.result!.thread!.id, mode)).error).toBeUndefined();
      }
    });

    it('rejects a named profile in the plain sandbox, where Spark sends a sandbox policy', async () => {
      const server = await open(true);
      const started = await server.call('thread/start', {
        cwd: project,
        config: codexConfig(false, null, false),
      });
      const threadId = started.result!.thread!.id;
      expect((await selects(server, threadId, 'read-only')).error?.message).toMatch(MISSING_TABLE);
      const legacy = await server.call('thread/settings/update', {
        threadId,
        sandboxPolicy: { type: 'readOnly', networkAccess: false },
      });
      expect(legacy.error).toBeUndefined();
    });
  },
);
