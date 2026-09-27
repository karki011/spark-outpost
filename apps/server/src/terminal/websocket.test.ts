import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { API_TOKEN_HEADER, type TerminalServerMessage } from '@spark-outpost/contracts';
import { loginShellSpawner } from './pty.ts';
import { TerminalSessions } from './sessions.ts';
import { attachTerminalSockets } from './websocket.ts';

const ORIGIN = 'http://127.0.0.1:5173';
const API_TOKEN = 'terminal-launch-token-0123456789abcdefghij';
let server: Server;
let sessions: TerminalSessions;
let port: number;

beforeEach(async () => {
  server = createServer((_req, res) => res.end());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
  sessions = new TerminalSessions(loginShellSpawner('/bin/sh'));
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
});
