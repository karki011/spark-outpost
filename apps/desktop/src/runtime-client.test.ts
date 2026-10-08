import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { connect as connectSocket } from 'node:net';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { LocalRuntime } from './runtime-client.ts';

let bundle: string;
let folder: string;
const runtimes: LocalRuntime[] = [];
const outside: ChildProcess[] = [];

beforeAll(async () => {
  folder = await mkdtemp(path.join(os.tmpdir(), 'spark-runtime-'));
  bundle = path.join(import.meta.dirname, '../dist', `runtime-test-${Date.now()}`);
  await build({
    entryPoints: [
      path.join(import.meta.dirname, 'runtime-host.ts'),
      path.join(import.meta.dirname, 'server-entry.ts'),
    ],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    outdir: bundle,
    external: ['embedded-postgres', 'pg', 'tsx'],
  });
});
afterEach(async () => {
  for (const child of outside.splice(0)) child.kill('SIGTERM');
  for (const runtime of runtimes.splice(0)) await runtime.stop().catch(() => undefined);
});
afterAll(async () => {
  await rm(folder, { recursive: true, force: true });
  await rm(bundle, { recursive: true, force: true });
});

async function connect(userData: string) {
  const runtime = await LocalRuntime.connect({
    userData,
    bootstrap: path.join(bundle, 'runtime-host.js'),
    log: () => undefined,
  });
  runtimes.push(runtime);
  return runtime;
}
async function until(check: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 5_000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('Runtime event did not arrive.');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function fixture(userData: string) {
  const entry = path.join(userData, 'service.mjs');
  await writeFile(
    entry,
    `process.send({ kind: 'ready', pid: process.pid }); process.on('message', message => { if (message.ping) process.send({kind: 'pong', pid: process.pid}); }); setInterval(() => {}, 1000);`,
  );
  return {
    name: 'Spark test service',
    bootstrap: path.join(bundle, 'server-entry.js'),
    entry,
    cwd: userData,
    env: process.env,
    log: () => undefined,
  };
}

describe('independent local runtime', () => {
  it('keeps control credentials private and refuses an unauthenticated local connection', async () => {
    const userData = await mkdtemp(path.join(folder, 'auth-'));
    const runtime = await connect(userData);
    const directory = path.join(userData, 'runtime');
    const endpoint = JSON.parse(await readFile(path.join(directory, 'endpoint.json'), 'utf8')) as {
      port: number;
    };
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    expect((await stat(path.join(directory, 'token'))).mode & 0o777).toBe(0o600);
    expect((await stat(path.join(directory, 'endpoint.json'))).mode & 0o777).toBe(0o600);
    let reply = '';
    await new Promise<void>((resolve) => {
      const socket = connectSocket(endpoint.port, '127.0.0.1', () => {
        socket.write(
          `${JSON.stringify({ id: randomUUID(), token: 'wrong'.repeat(8), request: { kind: 'info' } })}\n`,
        );
      });
      socket.on('data', (chunk: Buffer) => {
        reply += chunk.toString('utf8');
      });
      socket.on('close', () => resolve());
    });
    expect(reply).toBe('');
    expect(await runtime.info()).toEqual({ database: null, api: null });
  });

  it('adopts the same service after the desktop connection disappears and stops only its owned child', async () => {
    const external = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
    });
    external.unref();
    outside.push(external);
    const userData = await mkdtemp(path.join(folder, 'adopt-'));
    const first = await connect(userData);
    const options = await fixture(userData);
    let pid = 0;
    first.service({
      ...options,
      connect: () => ({
        receive: (raw) => {
          const message = raw as { kind: string; pid: number };
          if (message.kind === 'ready') pid = message.pid;
        },
        close: () => undefined,
      }),
    });
    await until(() => pid > 0);
    first.detach();
    runtimes.splice(runtimes.indexOf(first), 1);
    expect(alive(pid)).toBe(true);
    const next = await connect(userData);
    let adoptedPid = 0;
    let port: { post(message: unknown): void } | null = null;
    next.service({
      ...options,
      connect: (attached) => {
        port = attached;
        return {
          receive: (raw) => {
            adoptedPid = (raw as { pid: number }).pid;
          },
          close: () => undefined,
        };
      },
    });
    await until(() => port !== null);
    port!.post({ ping: true });
    await until(() => adoptedPid > 0);
    expect(adoptedPid).toBe(pid);
    await next.stop();
    runtimes.splice(runtimes.indexOf(next), 1);
    await until(() => !alive(pid));
    expect(alive(external.pid!)).toBe(true);
  });

  it('survives a controller process being killed and reuses the launch identity', async () => {
    const userData = await mkdtemp(path.join(folder, 'crash-'));
    const options = await fixture(userData);
    const resultFile = path.join(userData, 'ready.json');
    const controller = path.join(userData, 'controller.mjs');
    const module = pathToFileURL(path.join(import.meta.dirname, 'runtime-client.ts')).href;
    await writeFile(
      controller,
      `import { writeFile } from 'node:fs/promises'; import { LocalRuntime } from ${JSON.stringify(module)}; const runtime = await LocalRuntime.connect({ userData: ${JSON.stringify(userData)}, bootstrap: ${JSON.stringify(path.join(bundle, 'runtime-host.js'))}, log: () => {} }); await runtime.configure({port: 12345, token: 'test-launch-identity', version: 'test'}); runtime.service({ ...${JSON.stringify(options)}, log: () => {}, connect: () => ({receive: async message => { await writeFile(${JSON.stringify(resultFile)}, JSON.stringify(message)); process.kill(process.pid, 'SIGKILL'); }, close: () => {}}) });`,
    );
    const child = spawn(
      process.execPath,
      [
        '--import',
        pathToFileURL(path.join(import.meta.dirname, '../node_modules/tsx/dist/loader.mjs')).href,
        controller,
      ],
      { stdio: 'pipe' },
    );
    let errors = '';
    child.stderr.on('data', (chunk: Buffer) => {
      errors += chunk.toString('utf8');
    });
    const exit = await new Promise<NodeJS.Signals | null>((resolve) =>
      child.on('exit', (_code, signal) => resolve(signal)),
    );
    expect(errors).toBe('');
    expect(exit).toBe('SIGKILL');
    const { pid } = JSON.parse(await readFile(resultFile, 'utf8')) as { pid: number };
    expect(alive(pid)).toBe(true);
    const recovered = await connect(userData);
    expect((await recovered.info()).api).toEqual({
      port: 12345,
      token: 'test-launch-identity',
      version: 'test',
    });
    await recovered.stop();
    runtimes.splice(runtimes.indexOf(recovered), 1);
    await until(() => !alive(pid));
  });
});
