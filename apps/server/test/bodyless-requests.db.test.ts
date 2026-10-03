import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import type { Server } from 'node:http';
import { connect, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { API_TOKEN_HEADER } from '@spark-outpost/contracts';
import { API_TOKEN, createTestApp, HOST, localClient, ORIGIN } from './app-support.ts';
import { connectCliProvider, createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let server: Server;
let port: number;
let client: ReturnType<typeof localClient>;
let root: string;

beforeEach(async () => {
  t = await createTestDb();
  await connectCliProvider(t, 'claude');
  const app = createTestApp(t, { deleteSettleMs: 0 });
  client = localClient(app);
  root = await mkdtemp(path.join(tmpdir(), 'spark-bodyless-'));
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  port = (server.address() as AddressInfo).port;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await t.cleanup();
  await rm(root, { recursive: true, force: true });
});

function chromiumRequest(method: string, target: string): Promise<number> {
  const head = [
    `${method} ${target} HTTP/1.1`,
    `Host: ${HOST}`,
    `Origin: ${ORIGIN}`,
    'Content-Type: application/json',
    `${API_TOKEN_HEADER}: ${API_TOKEN}`,
    'Connection: close',
    '',
    '',
  ].join('\r\n');
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1', () => socket.write(head));
    let reply = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => (reply += chunk));
    socket.on('error', reject);
    socket.on('end', () => resolve(Number(/^HTTP\/1\.1 (\d{3})/.exec(reply)?.[1])));
  });
}

async function chat(): Promise<string> {
  const id = randomUUID();
  expect((await client.send('post', '/api/conversations', { id })).status).toBe(201);
  return id;
}

async function project(): Promise<string> {
  const response = await client.send('post', '/api/projects', { rootPath: root });
  expect(response.status).toBe(201);
  return (response.body as { id: string }).id;
}

async function teammate(): Promise<string> {
  const response = await client.send('post', '/api/teammates', { name: 'wren' });
  expect(response.status).toBe(201);
  return (response.body as { id: string }).id;
}

async function mcpServer(): Promise<string> {
  const response = await client.send('post', '/api/mcp/servers', {
    name: 'docs',
    transport: 'http',
    command: null,
    args: [],
    url: 'https://mcp.example.test/mcp',
    env: {},
    headers: {},
  });
  expect(response.status).toBe(201);
  return (response.body as { servers: { id: string }[] }).servers[0]!.id;
}

describe('requests without a body, sent the way Chromium sends them', () => {
  it('reach every DELETE route the app calls without a body', async () => {
    const conversationId = await chat();
    const routes: [string, number][] = [
      [`/api/conversations/${conversationId}/queue/${randomUUID()}`, 200],
      [`/api/conversations/${conversationId}`, 204],
      [`/api/projects/${await project()}`, 200],
      [`/api/teammates/${await teammate()}`, 204],
      ['/api/tickets/connections/linear', 200],
      ['/api/tickets/linear/ENG-1/snooze', 404],
      [`/api/terminal/sessions/${randomUUID()}`, 204],
      [`/api/mcp/servers/${await mcpServer()}`, 200],
      ['/api/providers/claude/connection', 200],
      ['/api/github/token', 200],
    ];
    const answered = [];
    for (const [route] of routes) answered.push([route, await chromiumRequest('DELETE', route)]);
    expect(answered).toEqual(routes);
    expect((await client.get(`/api/conversations/${conversationId}`)).status).toBe(404);
  });

  it('answers a bodyless PATCH like one with an empty JSON body', async () => {
    const conversationId = await chat();
    const route = `/api/conversations/${conversationId}`;
    const empty = await client.send('patch', route, {});
    expect(await chromiumRequest('PATCH', route)).toBe(empty.status);
  });
});
