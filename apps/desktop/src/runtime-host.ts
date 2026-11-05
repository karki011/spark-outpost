import { fork, type ChildProcess, type Serializable } from 'node:child_process';
import { chmod, rename, rm, writeFile } from 'node:fs/promises';
import { connect, createServer, type Socket } from 'node:net';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { setTimeout as delay } from 'node:timers/promises';
import { STOP_KEEPING_TERMINALS } from '@spark-outpost/contracts';
import { startDatabase, type Database } from './postgres.ts';
import { descendantsOf, isAlive, processTable } from '../../server/src/terminal/process-group.ts';
import { isBundledService, serverEntry } from './runtime-entries.ts';
import { createSecret, runtimePaths, runtimeProof, sameProof } from './runtime-handshake.ts';
import {
  RUNTIME_FRAME_LIMIT,
  runtimeFrameSchema,
  type RuntimeEvent,
  type RuntimeInfo,
  type RuntimeRequest,
} from './runtime-protocol.ts';

interface Service {
  child: ChildProcess;
  exited: Promise<number | null>;
  ownsTerminals: boolean;
}

const directory = process.argv[2] ?? '';
if (!directory) throw new Error('The local runtime needs its channel directory.');
const paths = runtimePaths(directory);
const token = createSecret();
const services = new Map<string, Service>();
const clients = new Set<Socket>();
const browserPorts = new Map<string, unknown>();
const pendingBrowser = new Map<string, { name: string; message: unknown }>();
const version = process.argv[3] ?? null;
const bundled = {
  bootstrap: path.join(import.meta.dirname, 'server-entry.js'),
  serverDir: process.argv[4] ? path.resolve(process.argv[4]) : null,
};
const info: RuntimeInfo = { version, pid: process.pid, database: null, api: null };
let database: Database | null = null;
let databaseStarting: Promise<Database> | null = null;
let desktop: Socket | null = null;
let stopping: Promise<void> | null = null;

function send(socket: Socket, event: RuntimeEvent) {
  if (!socket.destroyed) socket.write(`${JSON.stringify(event)}\n`);
}

function publish(event: RuntimeEvent) {
  for (const client of clients) send(client, event);
}

function unavailable(name: string, raw: unknown) {
  const message = raw as { kind?: string; id?: string };
  if (message?.kind !== 'browser:request' || typeof message.id !== 'string') return;
  services.get(name)?.child.send({
    kind: 'browser:response',
    id: message.id,
    ok: false,
    code: 'failed',
    message: 'The Spark desktop is disconnected. Reopen Spark to use Browser tools.',
  });
}

function askToStop(child: ChildProcess, keepTerminals: boolean) {
  if (keepTerminals && child.connected) {
    try {
      child.send(STOP_KEEPING_TERMINALS);
      return;
    } catch {
      child.kill('SIGTERM');
      return;
    }
  }
  child.kill('SIGTERM');
}

async function stopService(name: string, keepTerminals: boolean) {
  const service = services.get(name);
  if (!service) return;
  const descendants = service.child.pid
    ? descendantsOf(service.child.pid, await processTable())
    : [];
  askToStop(service.child, keepTerminals && service.ownsTerminals);
  const finished = await Promise.race([
    service.exited.then(() => true),
    delay(10_000, undefined, { ref: false }).then(() => false),
  ]);
  if (!finished) service.child.kill('SIGKILL');
  await service.exited;
  for (const pid of descendants) {
    if (!isAlive(pid)) continue;
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      continue;
    }
  }
  if (descendants.some(isAlive)) await delay(1_500);
  for (const pid of descendants) {
    if (!isAlive(pid)) continue;
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      continue;
    }
  }
}

function shutdown(keepTerminals: boolean): Promise<void> {
  stopping ??= (async () => {
    await Promise.all([...services.keys()].map((name) => stopService(name, keepTerminals)));
    await database?.stop();
    database = null;
    server.close();
    await rm(paths.endpoint, { force: true });
    await rm(paths.token, { force: true });
    process.exitCode = 0;
  })();
  return stopping;
}

async function handle(request: RuntimeRequest): Promise<unknown> {
  if (request.kind === 'shutdown') {
    await shutdown(request.keepTerminals === true);
    return null;
  }
  if (stopping) throw new Error('The local runtime is stopping.');
  if (request.kind === 'info') return info;
  if (request.kind === 'database:start') {
    if (!database) {
      databaseStarting ??= startDatabase({
        ...request.options,
        log: (line) => publish({ kind: 'log', name: 'postgres', line }),
      });
      try {
        database = await databaseStarting;
      } finally {
        databaseStarting = null;
      }
    }
    info.database = { url: database.url, port: Number(new URL(database.url).port) };
    return info.database;
  }
  if (request.kind === 'database:stop') {
    await database?.stop();
    database = null;
    info.database = null;
    return null;
  }
  if (request.kind === 'configure') {
    info.api = request.api;
    return null;
  }
  if (request.kind === 'service:stop') {
    await stopService(request.name, request.keepTerminals === true);
    return null;
  }
  if (request.kind === 'service:post') {
    const message = request.message as { id?: string };
    if (typeof message?.id === 'string') pendingBrowser.delete(message.id);
    services.get(request.name)?.child.send(request.message as Serializable);
    return null;
  }
  const options = request.options;
  if (!isBundledService(options, bundled))
    throw new Error(`${options.name} was not started: its entry is not part of this app.`);
  if (services.has(options.name)) {
    const ports = browserPorts.get(options.name);
    if (ports && desktop)
      send(desktop, { kind: 'service:message', name: options.name, message: ports });
    return null;
  }
  const child = fork(options.bootstrap, [options.entry], {
    cwd: options.cwd,
    env: { ...options.env, ELECTRON_RUN_AS_NODE: '1' },
    execPath: process.execPath,
    execArgv: [],
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  const log = (chunk: Buffer) => {
    for (const line of chunk.toString('utf8').split('\n').filter(Boolean))
      publish({ kind: 'log', name: options.name, line });
  };
  child.stdout?.on('data', log);
  child.stderr?.on('data', log);
  child.on('message', (message: unknown) => {
    if ((message as { kind?: string })?.kind === 'browser:ports')
      browserPorts.set(options.name, message);
    if (!desktop || desktop.destroyed) {
      unavailable(options.name, message);
      return;
    }
    const browser = message as { kind?: string; id?: string };
    if (browser?.kind === 'browser:request' && typeof browser.id === 'string') {
      pendingBrowser.set(browser.id, { name: options.name, message });
    }
    send(desktop, { kind: 'service:message', name: options.name, message });
  });
  const exited = new Promise<number | null>((resolve) => {
    child.once('exit', (code) => {
      services.delete(options.name);
      publish({ kind: 'service:exit', name: options.name, code });
      resolve(code);
    });
    child.once('error', () => {
      services.delete(options.name);
      publish({ kind: 'service:exit', name: options.name, code: 1 });
      resolve(1);
    });
  });
  const ownsTerminals =
    bundled.serverDir !== null &&
    path.resolve(options.entry) === serverEntry(bundled.serverDir, 'api');
  services.set(options.name, { child, exited, ownsTerminals });
  return null;
}

const server = createServer((socket) => {
  let buffer = '';
  const decoder = new StringDecoder('utf8');
  let expected: string | null = null;
  let proven = false;
  socket.on('data', (chunk: Buffer) => {
    buffer += decoder.write(chunk);
    if (buffer.length > RUNTIME_FRAME_LIMIT) {
      socket.destroy();
      return;
    }
    let boundary: number;
    while ((boundary = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 1);
      let raw: unknown;
      try {
        raw = JSON.parse(line);
      } catch {
        socket.destroy();
        return;
      }
      const parsed = runtimeFrameSchema.safeParse(raw);
      if (!parsed.success) {
        socket.destroy();
        return;
      }
      const frame = parsed.data;
      if ('kind' in frame) {
        if (frame.kind === 'hello' && expected === null && !proven) {
          const nonce = createSecret();
          expected = runtimeProof(token, 'client', frame.nonce, nonce);
          send(socket, {
            kind: 'welcome',
            nonce,
            proof: runtimeProof(token, 'host', frame.nonce, nonce),
          });
          continue;
        }
        if (frame.kind === 'proof' && expected !== null && sameProof(frame.proof, expected)) {
          expected = null;
          proven = true;
          clients.add(socket);
          desktop = socket;
          continue;
        }
        socket.destroy();
        return;
      }
      if (!proven) {
        socket.destroy();
        return;
      }
      void handle(frame.request).then(
        (result) => {
          send(socket, { kind: 'reply', id: frame.id, result });
          if (frame.request.kind === 'shutdown') for (const client of clients) client.end();
        },
        (error: Error) => send(socket, { kind: 'reply', id: frame.id, error: error.message }),
      );
    }
  });
  socket.on('error', () => undefined);
  socket.on('close', () => {
    clients.delete(socket);
    if (desktop !== socket) return;
    desktop = null;
    for (const pending of pendingBrowser.values()) unavailable(pending.name, pending.message);
    pendingBrowser.clear();
  });
});
const answered = await new Promise<boolean>((resolve) => {
  const probe = connect(paths.socket);
  probe.once('connect', () => {
    probe.destroy();
    resolve(true);
  });
  probe.once('error', () => resolve(false));
});
if (answered) process.exit(0);
await rm(paths.socket, { force: true });
await rm(paths.endpoint, { force: true });
await writeFile(`${paths.token}.next`, token, { mode: 0o600 });
await rename(`${paths.token}.next`, paths.token);
const umask = process.umask(0o077);
server.listen(paths.socket, async () => {
  process.umask(umask);
  await chmod(paths.socket, 0o600);
  await writeFile(paths.endpoint, JSON.stringify({ pid: process.pid, version }), { mode: 0o600 });
  await chmod(paths.endpoint, 0o600);
});
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.on(signal, () => {
    void shutdown(true).finally(() => {
      for (const client of clients) client.end();
    });
  });
