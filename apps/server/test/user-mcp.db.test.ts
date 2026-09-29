import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ChatMcpList, Project, UserMcpList, UserMcpServer } from '@spark-outpost/contracts';
import { loadUserMcp } from '../src/mcp/launch.ts';
import { createConversation } from '../src/persistence/conversations.ts';
import { memorySecretStore, type SecretStore } from '../src/setup/secrets.ts';
import { createTestApp, LOCAL_HEADERS, ORIGIN } from './app-support.ts';
import { createTestDb, type TestDb } from './support.ts';

const ECHO = join(import.meta.dirname, 'echo-mcp-server.mjs');
const TOKEN = 'ghp_valueThatMustNeverReachTheDb';

let t: TestDb;
let secrets: SecretStore;
let app: ReturnType<typeof createTestApp>;
let base: string;
let folder: string;

beforeAll(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'spark-user-mcp-db-')));
  folder = join(base, 'repo');
  await mkdir(folder);
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

beforeEach(async () => {
  t = await createTestDb();
  secrets = memorySecretStore();
  app = createTestApp(t, { secrets });
});

afterEach(async () => {
  await t.cleanup();
});

const get = (path: string) => request(app).get(path).set(LOCAL_HEADERS);
const send = (method: 'post' | 'put' | 'delete', path: string, body: object = {}) =>
  request(app)[method](path).set(LOCAL_HEADERS).set('Origin', ORIGIN).send(body);

const echoBody = (extraArg = '') => ({
  name: 'echo',
  transport: 'stdio',
  command: process.execPath,
  args: [ECHO, join(base, 'started'), ...(extraArg ? [extraArg] : [])],
  url: null,
  env: { ECHO_TOKEN: TOKEN },
  headers: {},
});

async function added(): Promise<UserMcpServer> {
  const list = (await send('post', '/api/mcp/servers', echoBody()).expect(201)).body as UserMcpList;
  return list.servers.find((server) => server.name === 'echo')!;
}

async function everythingStored(): Promise<string> {
  const { rows } = await t.db.query(
    `SELECT (SELECT json_agg(s) FROM mcp_servers s) AS servers,
            (SELECT json_agg(a) FROM agent_config_audit a) AS audit,
            (SELECT json_agg(e) FROM mcp_server_enablements e) AS enablements`,
  );
  return JSON.stringify(rows);
}

async function chatWith(projectId: string | null): Promise<string> {
  const chatId = randomUUID();
  await createConversation(t.db, t.workspaceId, chatId);
  if (projectId) {
    await t.db.query(
      'INSERT INTO conversation_projects (conversation_id, project_id, position) VALUES ($1, $2, 0)',
      [chatId, projectId],
    );
  }
  return chatId;
}

describe('user-level MCP servers', () => {
  it('keeps servers imported earlier as read-only entries', async () => {
    await t.db.query(
      `INSERT INTO mcp_servers (id, workspace_id, source, name, transport, config, fingerprint)
       VALUES (gen_random_uuid(), $1, 'imported:cursor', 'old', 'stdio', $2, 'fp-old')`,
      [
        t.workspaceId,
        {
          command: 'old-mcp',
          args: [],
          url: null,
          envNames: [],
          headerNames: [],
          secretNames: [],
          importableNames: ['OLD_TOKEN'],
          origin: '/home/.cursor/mcp.json',
        },
      ],
    );
    const list = (await get('/api/mcp/servers').expect(200)).body as UserMcpList;
    expect(list.servers).toEqual([
      expect.objectContaining({ source: 'imported:cursor', name: 'old', global: null }),
    ]);
    expect(list.servers[0]).not.toHaveProperty('importableNames');
    expect(list).not.toHaveProperty('scan');
    await send('put', `/api/mcp/servers/${list.servers[0]!.id}`, echoBody()).expect(400);
    await send('post', '/api/mcp/scan').expect(404);
  });

  it('adds a server by hand with its secret in the keychain, and tests the connection', async () => {
    const created = await send('post', '/api/mcp/servers', {
      name: 'local-echo',
      transport: 'stdio',
      command: process.execPath,
      args: [ECHO, join(base, 'probe-marker')],
      url: null,
      env: { ECHO_TOKEN: TOKEN },
      headers: {},
    }).expect(201);
    const server = (created.body as UserMcpList).servers.find((s) => s.name === 'local-echo')!;
    expect(server).toMatchObject({ source: 'user', secretNames: ['ECHO_TOKEN'] });
    expect(await everythingStored()).not.toContain(TOKEN);
    const tested = (await send('post', `/api/mcp/servers/${server.id}/test`).expect(200))
      .body as UserMcpList;
    expect(tested.servers[0]!.check).toMatchObject({
      ok: true,
      tools: ['echo', 'shout'],
      fingerprint: server.fingerprint,
    });
    await send('post', '/api/mcp/servers', {
      name: 'local-echo',
      transport: 'http',
      command: null,
      args: [],
      url: 'https://x.example/mcp',
      env: {},
      headers: {},
    }).expect(400);
    await send('delete', `/api/mcp/servers/${server.id}`).expect(200);
    expect(await secrets.get(`mcp:${server.id}`)).toBeNull();
  });

  it('keeps a stored value when an edit leaves it blank, and drops removed names', async () => {
    const body = {
      name: 'keep',
      transport: 'http',
      command: null,
      args: [],
      url: 'https://keep.example/mcp',
      env: {},
      headers: { Authorization: 'Bearer one', 'X-Old': 'two' },
    };
    const list = (await send('post', '/api/mcp/servers', body).expect(201)).body as UserMcpList;
    const id = list.servers[0]!.id;
    await send('put', `/api/mcp/servers/${id}`, {
      ...body,
      headers: { Authorization: '' },
    }).expect(200);
    expect(JSON.parse((await secrets.get(`mcp:${id}`))!)).toEqual({
      env: {},
      headers: { Authorization: 'Bearer one' },
    });
  });

  it('turns on per scope: all chats, a project override and a chat override', async () => {
    const echo = await added();
    const project = (await send('post', '/api/projects', { rootPath: folder }).expect(201))
      .body as Project;
    const inProject = await chatWith(project.id);
    const plain = await chatWith(null);
    const enable = (body: object) => send('put', `/api/mcp/servers/${echo.id}/enable`, body);

    await enable({ scope: 'global', enabled: true }).expect(400);
    await enable({ scope: 'global', enabled: true, fingerprint: 'other' }).expect(409);
    await enable({ scope: 'global', enabled: true, fingerprint: echo.fingerprint }).expect(200);
    await enable({ scope: 'project', scopeId: project.id, enabled: false }).expect(200);
    expect((await loadUserMcp(t.db, plain, [])).map((s) => s.name)).toEqual(['echo']);
    expect(await loadUserMcp(t.db, inProject, [project.id])).toEqual([]);

    await enable({
      scope: 'chat',
      scopeId: inProject,
      enabled: true,
      fingerprint: echo.fingerprint,
    }).expect(200);
    expect((await loadUserMcp(t.db, inProject, [project.id])).map((s) => s.name)).toEqual(['echo']);
    const chat = (await get(`/api/conversations/${inProject}/mcp`).expect(200)).body as ChatMcpList;
    expect(chat.servers).toEqual([
      expect.objectContaining({ kind: 'user', name: 'echo', enabled: true, via: 'chat' }),
    ]);

    await enable({ scope: 'chat', scopeId: inProject, enabled: null }).expect(200);
    expect(await loadUserMcp(t.db, inProject, [project.id])).toEqual([]);
    const { rows } = await t.db.query<{ enabled: boolean; detail: { scope: string } }>(
      `SELECT enabled, detail FROM agent_config_audit WHERE subject = 'mcp' ORDER BY created_at`,
    );
    expect(rows.map((row) => [row.detail.scope, row.enabled])).toEqual([
      ['global', true],
      ['project', false],
      ['chat', true],
      ['chat', false],
    ]);
  });

  it('switches a server off everywhere once its config changes, until it is reviewed again', async () => {
    const echo = await added();
    await send('put', `/api/mcp/servers/${echo.id}/enable`, {
      scope: 'global',
      enabled: true,
      fingerprint: echo.fingerprint,
    }).expect(200);
    const chat = await chatWith(null);
    expect(await loadUserMcp(t.db, chat, [])).toHaveLength(1);

    const edited = await send('put', `/api/mcp/servers/${echo.id}`, echoBody('--changed'));
    expect(edited.status).toBe(200);
    const changed = (edited.body as UserMcpList).servers[0]!;
    expect(changed.id).toBe(echo.id);
    expect(changed.fingerprint).not.toBe(echo.fingerprint);
    expect(changed.global).toEqual({ enabled: false, changed: true });
    expect(await loadUserMcp(t.db, chat, [])).toEqual([]);

    await send('put', `/api/mcp/servers/${echo.id}/enable`, {
      scope: 'global',
      enabled: true,
      fingerprint: changed.fingerprint,
    }).expect(200);
    expect(await loadUserMcp(t.db, chat, [])).toHaveLength(1);
  });

  it('lists the repo’s servers for a chat without touching them', async () => {
    await writeFile(
      join(folder, '.mcp.json'),
      JSON.stringify({ mcpServers: { repo: { command: 'repo-mcp' } } }),
    );
    const project = (await send('post', '/api/projects', { rootPath: folder }).expect(201))
      .body as Project;
    const chat = await chatWith(project.id);
    const list = (await get(`/api/conversations/${chat}/mcp`).expect(200)).body as ChatMcpList;
    expect(list.servers).toEqual([
      expect.objectContaining({ kind: 'project', name: 'repo', enabled: false, changed: false }),
    ]);
    await rm(join(folder, '.mcp.json'));
  });
});
