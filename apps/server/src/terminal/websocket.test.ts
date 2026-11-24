import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import {
  API_TOKEN_HEADER,
  type TerminalColors,
  type TerminalServerMessage,
} from '@spark-outpost/contracts';
import { loginShellSpawner } from './pty.ts';
import { TEST_SHELL } from './test-shell.fixture.ts';
import { TerminalSessions } from './sessions.ts';
import { attachTerminalSockets } from './websocket.ts';

const ORIGIN = 'http://127.0.0.1:5173';
const API_TOKEN = 'terminal-launch-token-0123456789abcdefghij';
let server: Server;
let sessions: TerminalSessions;
let port: number;
let reported: TerminalColors[];

beforeEach(async () => {
  server = createServer((_req, res) => res.end());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
  const spawn = loginShellSpawner(TEST_SHELL);
  reported = [];
  sessions = new TerminalSessions((options) => ({
    ...spawn(options),
    colors: (colors) => reported.push(colors),
  }));
  attachTerminalSockets(server, sessions, { port, allowedOrigins: [ORIGIN], apiToken: API_TOKEN });
});

afterEach(async () => {
  sessions.killAll();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

function connect(path: string, origin?: string, apiToken: string | null = API_TOKEN) {
  const headers = apiToken === null ? {} : { [API_TOKEN_HEADER]: apiToken };
  return new WebSocket(`ws://127.0.0.1:${port}${path}`, origin ? { origin, headers } : { headers });
}

function rejectedStatus(socket: WebSocket): Promise<number> {
  return new Promise((resolve) =>
    socket.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0)),
  );
}

describe('terminal websocket', () => {
  it('refuses connections without an allowed origin', async () => {
    const { id, token } = sessions.create('claude');
    const path = `/api/terminal/sessions/${id}/stream?token=${token}`;
    expect(await rejectedStatus(connect(path))).toBe(403);
    expect(await rejectedStatus(connect(path, 'https://evil.example'))).toBe(403);
  });

  it('refuses connections without the launch token', async () => {
    const { id, token } = sessions.create('claude');
    const path = `/api/terminal/sessions/${id}/stream?token=${token}`;
    expect(await rejectedStatus(connect(path, ORIGIN, null))).toBe(401);
    expect(await rejectedStatus(connect(path, ORIGIN, `${API_TOKEN}x`))).toBe(401);
  });

  it('closes with 4401 for a wrong token', async () => {
    const { id } = sessions.create('claude');
    const socket = connect(`/api/terminal/sessions/${id}/stream?token=nope`, ORIGIN);
    const code = await new Promise<number>((resolve) =>
      socket.on('close', (closeCode) => resolve(closeCode)),
    );
    expect(code).toBe(4401);
  });

  it('streams the terminal and ends it when the client asks to close', async () => {
    const { id, token } = sessions.create('codex');
    const socket = connect(
      `/api/terminal/sessions/${id}/stream?token=${token}&cols=90&rows=20`,
      ORIGIN,
    );
    const messages: TerminalServerMessage[] = [];
    let screen = '';
    socket.on('message', (raw, isBinary) => {
      if (isBinary) screen += String(raw);
      else messages.push(JSON.parse(String(raw)) as TerminalServerMessage);
    });
    await new Promise((resolve) => socket.on('open', resolve));

    const joined = () => screen;
    const deadline = Date.now() + 4000;
    while (!joined().includes('npm i -g @openai/codex')) {
      if (Date.now() > deadline) throw new Error('The prefilled command never appeared.');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    socket.send(Buffer.from('\u0015echo "via-$((1+1))-binary"\r'), { binary: true });
    while (!screen.includes('via-2-binary')) {
      if (Date.now() > deadline) throw new Error('Binary input never reached the shell.');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    socket.send(JSON.stringify({ type: 'close' }));
    await new Promise((resolve) => socket.on('close', resolve));

    expect(messages.at(-1)).toEqual({ type: 'ended', reason: 'closed', exitCode: null });
    expect(sessions.activeCount).toBe(0);
  });

  it.skipIf(process.platform === 'win32')(
    'holds a flood back for a view that acknowledges output, and lets it through as it catches up',
    async () => {
      const { id, token } = sessions.create('codex');
      const socket = connect(`/api/terminal/sessions/${id}/stream?token=${token}`, ORIGIN);
      let received = 0;
      let tail = '';
      socket.on('message', (raw, isBinary) => {
        if (!isBinary) return;
        received += (raw as Buffer).length;
        tail = (tail + String(raw)).slice(-200);
      });
      await new Promise((resolve) => socket.on('open', resolve));
      socket.send(JSON.stringify({ type: 'ack', bytes: 0 }));
      socket.send(
        Buffer.from(
          '\u0015head -c 4000000 /dev/zero | tr "\\0" x; echo; echo "flood-$((1+1))-done"\r',
        ),
        { binary: true },
      );
      let last = -1;
      while (received !== last) {
        last = received;
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      expect(received).toBeGreaterThan(1024 * 1024);
      expect(received).toBeLessThan(3_000_000);
      expect(tail).not.toContain('flood-2-done');

      const deadline = Date.now() + 8000;
      let acked = 0;
      while (!tail.includes('flood-2-done')) {
        if (Date.now() > deadline) throw new Error('The flood never finished.');
        if (received > acked) {
          socket.send(JSON.stringify({ type: 'ack', bytes: received - acked }));
          acked = received;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(received).toBeGreaterThan(4_000_000);
      socket.send(JSON.stringify({ type: 'close' }));
      await new Promise((resolve) => socket.on('close', resolve));
    },
  );

  it('passes the colours the view reports to the terminal and ignores a malformed one', async () => {
    const { id, token } = sessions.create('codex');
    const socket = connect(`/api/terminal/sessions/${id}/stream?token=${token}`, ORIGIN);
    await new Promise((resolve) => socket.on('open', resolve));
    const colors = { foreground: '#241a13', background: '#faf2eb' };
    socket.send(JSON.stringify({ type: 'colors', colors: { ...colors, background: 'white' } }));
    socket.send(JSON.stringify({ type: 'colors', colors }));
    socket.send(JSON.stringify({ type: 'close' }));
    await new Promise((resolve) => socket.on('close', resolve));
    expect(reported).toEqual([colors]);
  });
});
