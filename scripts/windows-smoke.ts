import { spawn, execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFile, mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { completeReply } from './acp-reply.ts';
import { startDatabase } from '../apps/desktop/src/postgres.ts';
import { agentDefinitions } from '../apps/server/src/agents/acp/agents.ts';
import { parseShell } from '../apps/server/src/approvals/shell-parse.ts';
import { nativeKeyring } from '../apps/server/src/setup/keychain.ts';

interface Result {
  name: string;
  ok: boolean;
  detail: string;
}

type Check = () => Promise<string>;

interface PgClient {
  connect(): Promise<void>;
  query(text: string): Promise<{ rows: { version: string }[] }>;
  end(): Promise<void>;
}

interface PgModule {
  Client: new (options: { connectionString: string }) => PgClient;
}

interface PtyProcess {
  onData(listener: (data: string) => void): void;
  onExit(listener: (event: { exitCode: number }) => void): void;
}

interface PtyModule {
  spawn(
    file: string,
    args: string[],
    options: { cols: number; rows: number; cwd: string },
  ): PtyProcess;
}

const isWindows = process.platform === 'win32';
const serverRequire = createRequire(path.resolve('apps/server/package.json'));
const desktopRequire = createRequire(path.resolve('apps/desktop/package.json'));
const runFile = promisify(execFile);
const ACP_TIMEOUT_MS = 90_000;
const KEYRING_SIZES = [100, 1200, 1300, 2500, 2600, 5000];

async function withTempDir<T>(prefix: string, use: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  try {
    return await use(dir);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (!address || typeof address === 'string') throw new Error('No free port.');
  return address.port;
}

function postgresBinary(): string {
  const platform = isWindows ? 'windows' : process.platform;
  const binaries = desktopRequire(`@embedded-postgres/${platform}-${process.arch}`) as {
    postgres: string;
  };
  return binaries.postgres;
}

async function directRun(file: string, args: string[]): Promise<string> {
  const child = spawn(file, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (data) => {
    output += String(data);
  });
  child.stderr.on('data', (data) => {
    output += String(data);
  });
  const timer = setTimeout(() => child.kill(), 8_000);
  const code = await new Promise<string>((resolve) => {
    child.once('error', (error) => resolve(`spawn error ${error.message}`));
    child.once('exit', (exitCode, signal) => resolve(`exit ${exitCode ?? signal}`));
  });
  clearTimeout(timer);
  return `${code} ${output.trim().slice(-300)}`;
}

async function directPostgres(dataDir: string): Promise<string> {
  try {
    const binary = postgresBinary();
    const version = await directRun(binary, ['--version']);
    const start = await directRun(binary, ['-D', dataDir, '-p', String(await freePort())]);
    return `version: ${version}; start: ${start}`;
  } catch (error) {
    return `could not run: ${(error as Error).message}`;
  }
}

const postgres: Check = () =>
  withTempDir('spark-pg-', async (dir) => {
    const lines: string[] = [];
    const database = await startDatabase({
      dataDir: path.join(dir, 'data'),
      passwordFile: path.join(dir, 'password'),
      port: await freePort(),
      log: (line) => lines.push(line),
    }).catch(async (error: unknown) => {
      const tail = lines.slice(-6).join(' / ');
      const direct = await directPostgres(path.join(dir, 'data'));
      throw new Error(`${(error as Error).message} Log: ${tail} Direct: ${direct}`, {
        cause: error,
      });
    });
    try {
      const pg = desktopRequire('pg') as PgModule;
      const client = new pg.Client({ connectionString: database.url });
      await client.connect();
      const { rows } = await client.query('select version()');
      await client.end();
      return rows[0]?.version.split(',')[0] ?? 'connected';
    } finally {
      await database.stop();
    }
  });

const keyring: Check = async () => {
  const store = nativeKeyring(`spark-outpost-smoke-${randomBytes(4).toString('hex')}`);
  const outcomes: string[] = [];
  let largest = 0;
  for (const size of KEYRING_SIZES) {
    const account = `size-${size}`;
    const secret = 'x'.repeat(size);
    try {
      await store.set(account, secret);
      const read = await store.get(account);
      if (read !== secret) throw new Error('read back differently');
      largest = size;
      outcomes.push(`${size} ok`);
    } catch (error) {
      outcomes.push(`${size} failed (${(error as Error).message.slice(0, 60)})`);
    } finally {
      await store.delete(account).catch(() => undefined);
    }
  }
  if (largest === 0) throw new Error(outcomes.join('; '));
  return `largest stored: ${largest} chars; ${outcomes.join('; ')}`;
};

const pty: Check = async () => {
  const nodePty = serverRequire('node-pty') as PtyModule;
  const [file, args] = isWindows
    ? ['powershell.exe', ['-NoProfile', '-Command', 'Write-Output spark-pty-ok']]
    : ['/bin/sh', ['-c', 'echo spark-pty-ok']];
  const child = nodePty.spawn(file, args, { cols: 80, rows: 24, cwd: process.cwd() });
  let output = '';
  child.onData((data) => {
    output += data;
  });
  const code = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('pty timed out')), 30_000);
    child.onExit(({ exitCode }) => {
      clearTimeout(timer);
      resolve(exitCode);
    });
  });
  if (!output.includes('spark-pty-ok'))
    throw new Error(`exit ${code}, output: ${output.slice(0, 120)}`);
  return `${file} exit ${code}`;
};

const pipe: Check = () =>
  withTempDir('spark-pipe-', async (dir) => {
    const name = isWindows
      ? `\\\\.\\pipe\\spark-smoke-${randomBytes(4).toString('hex')}`
      : path.join(dir, 'smoke.sock');
    const server = net.createServer((socket) => socket.pipe(socket));
    await new Promise<void>((resolve) => server.listen(name, resolve));
    try {
      const echoed = await new Promise<string>((resolve, reject) => {
        const socket = net.connect(name, () => socket.write('ping'));
        socket.once('data', (data) => {
          socket.destroy();
          resolve(String(data));
        });
        socket.once('error', reject);
      });
      if (echoed !== 'ping') throw new Error(`echoed ${echoed}`);
      return name;
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

const bashParser: Check = async () => {
  const script = await parseShell('git push --force origin main && echo done > out.txt');
  if (!script) throw new Error('parser returned nothing');
  const words = script.commands.map((command) => command.words.map((word) => word.text).join(' '));
  if (words[0] !== 'git push --force origin main') throw new Error(`parsed: ${words.join(' | ')}`);
  return `${script.commands.length} commands, ${script.redirects.length} redirect`;
};

const gitBash: Check = async () => {
  const candidates = isWindows
    ? ['C:\\Program Files\\Git\\bin\\bash.exe', 'bash.exe']
    : ['/bin/bash', 'bash'];
  for (const candidate of candidates) {
    try {
      const { stdout } = await runFile(candidate, ['-c', 'echo "$BASH_VERSION"'], {
        timeout: 15_000,
      });
      return `${candidate}: bash ${stdout.trim()}`;
    } catch {
      continue;
    }
  }
  throw new Error(`no bash among ${candidates.join(', ')}`);
};

function acpStart(id: 'claude' | 'codex'): Check {
  return async () => {
    const launch = agentDefinitions[id].launch();
    const child = spawn(launch.command, launch.args, {
      env: { ...process.env, ...launch.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stderr.on('data', (data) => {
      stderr += String(data);
    });
    try {
      const reply = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('no initialize reply')), ACP_TIMEOUT_MS);
        const fail = (error: Error) => {
          clearTimeout(timer);
          reject(error);
        };
        child.once('error', fail);
        child.stdin.once('error', fail);
        child.once('exit', (code) => fail(new Error(`exited ${code}: ${stderr.slice(-200)}`)));
        child.stdout.on('data', (data) => {
          stdout += String(data);
          const line = completeReply(stdout, 1);
          if (line) {
            clearTimeout(timer);
            resolve(line);
          }
        });
        child.stdin.write(
          `${JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: { protocolVersion: 1, clientCapabilities: {} },
          })}\n`,
        );
      });
      const parsed = JSON.parse(reply) as {
        result?: { protocolVersion?: number; agentInfo?: { name?: string; version?: string } };
        error?: { message?: string };
      };
      if (!parsed.result) throw new Error(parsed.error?.message ?? reply.slice(0, 200));
      const info = parsed.result.agentInfo;
      return `ACP v${parsed.result.protocolVersion} ${info?.name ?? ''} ${info?.version ?? ''}`.trim();
    } finally {
      child.kill();
    }
  };
}

const CHECKS: [string, Check][] = [
  ['Embedded Postgres', postgres],
  ['Keychain sizes', keyring],
  ['PTY', pty],
  ['Named pipe / socket', pipe],
  ['Bash command parser', bashParser],
  ['Git Bash', gitBash],
  ['Claude ACP start', acpStart('claude')],
  ['Codex ACP start', acpStart('codex')],
];

async function runCheck([name, check]: [string, Check]): Promise<Result> {
  try {
    return { name, ok: true, detail: await check() };
  } catch (error) {
    return { name, ok: false, detail: (error as Error).message };
  }
}

function table(results: Result[]): string {
  const cell = (text: string) => text.replaceAll('|', '\\|').replaceAll('\n', ' ');
  const rows = results.map(
    (result) =>
      `| ${result.name} | ${result.ok ? '✅ Passed' : '❌ Failed'} | ${cell(result.detail)} |`,
  );
  return [
    `### Windows smoke (${process.platform} ${process.arch}, Node ${process.version})`,
    '',
    '| Check | Result | Detail |',
    '| --- | --- | --- |',
    ...rows,
    '',
  ].join('\n');
}

const results: Result[] = [];
for (const check of CHECKS) results.push(await runCheck(check));
const report = table(results);
console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, report);
process.exit(results.every((result) => result.ok) ? 0 : 1);
