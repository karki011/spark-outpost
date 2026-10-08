import { fork, type ChildProcess, type Serializable } from 'node:child_process';
import { timingSafeEqual } from 'node:crypto';
import { chmod, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Socket } from 'node:net';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { setTimeout as delay } from 'node:timers/promises';
import { startDatabase, type Database } from './postgres.ts';
import { descendantsOf, isAlive, processTable } from '../../server/src/terminal/process-group.ts';
import {
  RUNTIME_FRAME_LIMIT,
  runtimeEnvelopeSchema,
  type RuntimeEvent,
  type RuntimeInfo,
  type RuntimeRequest,
} from './runtime-protocol.ts';

interface Service {
  child: ChildProcess;
  exited: Promise<number | null>;
}

const directory = process.argv[2] ?? '';
if (!directory) throw new Error('The local runtime needs its channel directory.');
const token = (await readFile(path.join(directory, 'token'), 'utf8')).trim();
const services = new Map<string, Service>();
const clients = new Set<Socket>();
const browserPorts = new Map<string, unknown>();
const pendingBrowser = new Map<string, { name: string; message: unknown }>();
const info: RuntimeInfo = { database: null, api: null };
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

async function stopService(name: string) {
  const service = services.get(name);
  if (!service) return;
  const descendants = service.child.pid
    ? descendantsOf(service.child.pid, await processTable())
    : [];
  service.child.kill('SIGTERM');
  const finished = await Promise.race([
    service.exited.then(() => true),
    delay(10_000).then(() => false),
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

function shutdown(): Promise<void> {
  stopping ??= (async () => {
    await Promise.all([...services.keys()].map(stopService));
    await database?.stop();
    database = null;
    server.close();
    await rm(path.join(directory, 'endpoint.json'), { force: true });
    process.exitCode = 0;
  })();
  return stopping;
}

async function handle(request: RuntimeRequest): Promise<unknown> {
  if (request.kind === 'shutdown') {
    await shutdown();
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
    await stopService(request.name);
    return null;
  }
  if (request.kind === 'service:post') {
    const message = request.message as { id?: string };
    if (typeof message?.id === 'string') pendingBrowser.delete(message.id);
    services.get(request.name)?.child.send(request.message as Serializable);
    return null;
  }
  const options = request.options;
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
  services.set(options.name, { child, exited });
  return null;
}

const server = createServer((socket) => {
  let buffer = '';
  const decoder = new StringDecoder('utf8');
  let authenticated = false;
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
      const parsed = runtimeEnvelopeSchema.safeParse(raw);
      if (!parsed.success) {
        socket.destroy();
        return;
      }
      const envelope = parsed.data;
      const offered = Buffer.from(envelope.token);
      const expected = Buffer.from(token);
      if (offered.length !== expected.length || !timingSafeEqual(offered, expected)) {
        socket.destroy();
        return;
      }
      if (!authenticated) {
        authenticated = true;
        clients.add(socket);
        desktop = socket;
      }
      void handle(envelope.request).then(
        (result) => {
          send(socket, { kind: 'reply', id: envelope.id, result });
          if (envelope.request.kind === 'shutdown') for (const client of clients) client.end();
        },
        (error: Error) => send(socket, { kind: 'reply', id: envelope.id, error: error.message }),
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
server.listen(0, '127.0.0.1', async () => {
  const address = server.address();
  if (!address || typeof address === 'string') return;
  const endpoint = path.join(directory, 'endpoint.json');
  await writeFile(endpoint, JSON.stringify({ port: address.port, pid: process.pid }), {
    mode: 0o600,
  });
  await chmod(endpoint, 0o600);
});
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.on(signal, () => {
    void shutdown().finally(() => {
      for (const client of clients) client.end();
    });
  });
