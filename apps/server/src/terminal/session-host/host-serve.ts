import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { connect, createServer, type Socket } from 'node:net';
import { spawn as spawnNodePty } from 'node-pty';
import { killProcessTree } from '../process-group.ts';
import { cliDeps, cliRun, ptyArgs } from '../windows-cli.ts';
import { ensureSpawnHelperExecutable } from '../pty-helper.ts';
import { isPipe, sessionHostPaths, type SessionHostPaths } from './paths.ts';
import { createSecret, hostProof, sameProof } from './proof.ts';
import {
  clientFrameSchema,
  frameReader,
  sendFrame,
  type CreateRequest,
  type HostRequest,
} from './protocol.ts';
import { headlessScreen } from './screen.ts';
import { SessionTable, type HostPty } from './session-table.ts';

const IDLE_EXIT_MS = 10_000;

export function answers(socket: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = connect(socket);
    probe.once('connect', () => {
      probe.destroy();
      resolve(true);
    });
    probe.once('error', () => resolve(false));
  });
}

function spawnPty(start: CreateRequest): HostPty {
  const run = cliRun(start.command, start.args, process.platform, cliDeps(start.env));
  return spawnNodePty(run.file, ptyArgs(run), {
    name: 'xterm-256color',
    cols: start.cols,
    rows: start.rows,
    cwd: start.cwd,
    env: start.env,
  });
}

function writeToken(paths: SessionHostPaths, token: string): void {
  const staged = `${paths.token}.${process.pid}`;
  writeFileSync(staged, token, { mode: 0o600 });
  renameSync(staged, paths.token);
}

export interface ServeOptions {
  idleExitMs?: number;
  exit?: (code: number) => void;
}

export async function serveSessionHost(
  directory: string,
  options: ServeOptions = {},
): Promise<void> {
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const paths = sessionHostPaths(directory);
  if (await answers(paths.socket)) return exit(0);
  mkdirSync(paths.directory, { recursive: true, mode: 0o700 });
  if (!isPipe(paths.socket)) rmSync(paths.socket, { force: true });
  ensureSpawnHelperExecutable();
  const token = createSecret();

  const clients = new Set<Socket>();
  const watchers = new Map<string, Set<Socket>>();
  let idle: NodeJS.Timeout | null = null;
  let leaving = false;

  const table = new SessionTable({
    spawn: spawnPty,
    screen: headlessScreen,
    killTree: (pid) => killProcessTree(pid),
    output: (session, data) => {
      for (const socket of watchers.get(session) ?? [])
        sendFrame(socket, { kind: 'output', session, data });
    },
    exited: (session, result) => {
      for (const socket of watchers.get(session) ?? [])
        sendFrame(socket, { kind: 'exit', session, exit: result });
    },
  });

  const leave = (code: number) => {
    if (leaving) return;
    leaving = true;
    server.close();
    for (const socket of clients) socket.destroy();
    if (!isPipe(paths.socket)) rmSync(paths.socket, { force: true });
    exit(code);
  };
  const checkIdle = () => {
    const quiet = table.size === 0 && clients.size === 0;
    if (!quiet) {
      if (idle) clearTimeout(idle);
      idle = null;
      return;
    }
    idle ??= setTimeout(() => {
      idle = null;
      if (table.size === 0 && clients.size === 0) leave(0);
    }, options.idleExitMs ?? IDLE_EXIT_MS);
  };

  const handle = async (socket: Socket, request: HostRequest): Promise<unknown> => {
    switch (request.kind) {
      case 'create':
        return { pid: table.create(request) };
      case 'attach': {
        const attached = table.attach(request.session);
        const set = watchers.get(request.session) ?? new Set<Socket>();
        set.add(socket);
        watchers.set(request.session, set);
        return attached;
      }
      case 'write':
        return table.write(request.session, request.data);
      case 'resize':
        return table.resize(request.session, request.cols, request.rows);
      case 'screen':
        return table.screen(request.session);
      case 'list':
        return table.list();
      case 'kill':
        await table.kill(request.session);
        watchers.delete(request.session);
        return null;
      case 'remove':
        table.remove(request.session);
        watchers.delete(request.session);
        return null;
      case 'shutdown':
        await table.killAll();
        setImmediate(() => leave(0));
        return null;
    }
  };

  const server = createServer((socket) => {
    let expected: string | null = null;
    let proven = false;
    const read = frameReader(
      (raw) => {
        const parsed = clientFrameSchema.safeParse(raw);
        if (!parsed.success) return false;
        const frame = parsed.data;
        if ('kind' in frame) {
          if (frame.kind === 'hello' && expected === null && !proven) {
            const nonce = createSecret();
            expected = hostProof(token, 'client', frame.nonce, nonce);
            sendFrame(socket, {
              kind: 'welcome',
              nonce,
              proof: hostProof(token, 'host', frame.nonce, nonce),
            });
            return true;
          }
          if (frame.kind === 'proof' && expected !== null && sameProof(frame.proof, expected)) {
            expected = null;
            proven = true;
            clients.add(socket);
            checkIdle();
            return true;
          }
          return false;
        }
        if (!proven) return false;
        void handle(socket, frame.request).then(
          (result) => {
            sendFrame(socket, { kind: 'reply', id: frame.id, result: result ?? null });
            checkIdle();
          },
          (error: Error) => {
            sendFrame(socket, { kind: 'reply', id: frame.id, error: error.message.slice(0, 500) });
            checkIdle();
          },
        );
        return true;
      },
      () => socket.destroy(),
    );
    socket.on('data', (chunk: Buffer) => {
      if (!socket.destroyed) read(chunk);
    });
    socket.on('error', () => undefined);
    socket.on('close', () => {
      clients.delete(socket);
      for (const set of watchers.values()) set.delete(socket);
      checkIdle();
    });
    socket.on('end', () => socket.end());
  });
  server.on('error', () => leave(1));
  await new Promise<void>((resolve) => server.listen(paths.socket, resolve));
  writeToken(paths, token);
  checkIdle();
}
