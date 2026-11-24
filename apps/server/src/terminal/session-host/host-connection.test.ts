import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { connect, createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openHostConnection, withHostConnection } from './host-connection.ts';
import { serveSessionHost } from './host-serve.ts';
import { sessionHostPaths, type SessionHostPaths } from './paths.ts';
import { createSecret, hostProof } from './proof.ts';
import { encodeFrame, frameReader } from './protocol.ts';

let folder: string;
let paths: SessionHostPaths;
let fake: Server | null = null;
const accepted = new Set<Socket>();

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'shc-'));
  paths = sessionHostPaths(join(folder, 'host'));
  mkdirSync(paths.directory, { recursive: true });
});

afterEach(async () => {
  for (const socket of accepted) socket.destroy();
  accepted.clear();
  await new Promise<void>((done) => (fake ? fake.close(() => done()) : done()));
  fake = null;
  rmSync(folder, { recursive: true, force: true });
});

function listen(server: Server): Promise<void> {
  return new Promise((done) => server.listen(paths.socket, done));
}

describe('the session host connection', () => {
  it('connects to nothing without a token file', async () => {
    expect(await openHostConnection(paths)).toBeNull();
  });

  it('sends nothing past its hello to a host that cannot prove the token', async () => {
    writeFileSync(paths.token, createSecret());
    const received: unknown[] = [];
    fake = createServer((socket) => {
      accepted.add(socket);
      socket.on(
        'data',
        frameReader(
          (raw) => {
            received.push(raw);
            const nonce = createSecret();
            const wrong = hostProof(
              createSecret(),
              'host',
              (raw as { nonce: string }).nonce,
              nonce,
            );
            socket.write(encodeFrame({ kind: 'welcome', nonce, proof: wrong }));
            return true;
          },
          () => socket.destroy(),
        ),
      );
    });
    await listen(fake);
    expect(await openHostConnection(paths)).toBeNull();
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ kind: 'hello' });
  });

  it('gives up when the host never answers', async () => {
    writeFileSync(paths.token, createSecret());
    fake = createServer((socket) => accepted.add(socket));
    await listen(fake);
    expect(await openHostConnection(paths, 100)).toBeNull();
  });

  it('serves no request before the client proves the token', async () => {
    const exit = vi.fn();
    await serveSessionHost(paths.directory, { exit, idleExitMs: 60_000 });
    const lines: string[] = [];
    const closed = new Promise<void>((done) => {
      const socket = connect(paths.socket, () =>
        socket.write(encodeFrame({ id: 1, request: { kind: 'list' } })),
      );
      socket.on('data', (chunk) => lines.push(chunk.toString()));
      socket.on('close', () => done());
      socket.on('error', () => undefined);
    });
    await closed;
    expect(lines).toEqual([]);

    expect(await withHostConnection(paths, (host) => host.request({ kind: 'list' }))).toEqual([]);
    await withHostConnection(paths, (host) => host.request({ kind: 'shutdown' }));
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
  });

  it('exits once it has had no session and no client for its idle time', async () => {
    const exit = vi.fn();
    await serveSessionHost(paths.directory, { exit, idleExitMs: 50 });
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
  });
});
