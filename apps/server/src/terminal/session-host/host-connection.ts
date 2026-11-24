import { readFile } from 'node:fs/promises';
import { connect, type Socket } from 'node:net';
import type { SessionHostPaths } from './paths.ts';
import { createSecret, hostProof, sameProof } from './proof.ts';
import {
  frameReader,
  hostFrameSchema,
  sendFrame,
  type HostFrame,
  type HostRequest,
} from './protocol.ts';

const HANDSHAKE_MS = 5_000;

type Event = Extract<HostFrame, { kind: 'output' | 'exit' }>;

export interface HostConnection {
  request(request: HostRequest): Promise<unknown>;
  onEvent(listener: (event: Event) => void): void;
  onClose(listener: () => void): void;
  close(): void;
}

interface Pending {
  resolve(result: unknown): void;
  reject(error: Error): void;
}

async function readToken(path: string): Promise<string | null> {
  try {
    const token = (await readFile(path, 'utf8')).trim();
    return token.length >= 32 ? token : null;
  } catch {
    return null;
  }
}

export async function openHostConnection(
  paths: SessionHostPaths,
  handshakeMs: number = HANDSHAKE_MS,
): Promise<HostConnection | null> {
  const token = await readToken(paths.token);
  if (!token) return null;
  const socket: Socket = connect(paths.socket);
  const clientNonce = createSecret();
  const pending = new Map<number, Pending>();
  const eventListeners: ((event: Event) => void)[] = [];
  const closeListeners: (() => void)[] = [];
  let nextId = 0;
  let proven = false;
  let settle: (ok: boolean) => void = () => undefined;
  const ready = new Promise<boolean>((resolve) => {
    settle = resolve;
  });
  const timer = setTimeout(() => {
    settle(false);
    socket.destroy();
  }, handshakeMs);

  const read = frameReader(
    (raw) => {
      const parsed = hostFrameSchema.safeParse(raw);
      if (!parsed.success) return false;
      const frame = parsed.data;
      if (!proven) {
        if (frame.kind !== 'welcome') return false;
        const expected = hostProof(token, 'host', clientNonce, frame.nonce);
        if (!sameProof(frame.proof, expected)) return false;
        proven = true;
        sendFrame(socket, {
          kind: 'proof',
          proof: hostProof(token, 'client', clientNonce, frame.nonce),
        });
        settle(true);
        return true;
      }
      if (frame.kind === 'welcome') return false;
      if (frame.kind === 'reply') {
        const waiting = pending.get(frame.id);
        pending.delete(frame.id);
        if (frame.error !== undefined) waiting?.reject(new Error(frame.error));
        else waiting?.resolve(frame.result ?? null);
        return true;
      }
      for (const listener of eventListeners) listener(frame);
      return true;
    },
    () => socket.destroy(),
  );

  socket.on('connect', () => sendFrame(socket, { kind: 'hello', nonce: clientNonce }));
  socket.on('data', (chunk: Buffer) => {
    if (!socket.destroyed) read(chunk);
  });
  socket.on('error', () => undefined);
  socket.on('close', () => {
    clearTimeout(timer);
    settle(false);
    for (const waiting of pending.values()) waiting.reject(new Error('The session host closed.'));
    pending.clear();
    if (proven) for (const listener of closeListeners) listener();
  });

  const ok = await ready;
  clearTimeout(timer);
  if (!ok) {
    socket.destroy();
    return null;
  }
  return {
    request: (request) =>
      new Promise((resolve, reject) => {
        if (socket.destroyed) return reject(new Error('The session host closed.'));
        const id = nextId;
        nextId += 1;
        pending.set(id, { resolve, reject });
        sendFrame(socket, { id, request });
      }),
    onEvent: (listener) => {
      eventListeners.push(listener);
    },
    onClose: (listener) => {
      closeListeners.push(listener);
    },
    close: () => socket.destroy(),
  };
}

export async function withHostConnection<T>(
  paths: SessionHostPaths,
  work: (connection: HostConnection) => Promise<T>,
): Promise<T | null> {
  const connection = await openHostConnection(paths);
  if (!connection) return null;
  try {
    return await work(connection);
  } finally {
    connection.close();
  }
}
