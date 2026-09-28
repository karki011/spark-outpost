import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ChatMcpList, Project, UserMcpList, UserMcpServer } from '@spark-outpost/contracts';
import { loadUserMcp } from '../src/mcp/launch.ts';
import { scanHomesAt } from '../src/mcp/scan.ts';
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
let home: string;
let folder: string;

beforeAll(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'spark-user-mcp-db-')));
  home = join(base, 'home');
  folder = join(base, 'repo');
  await mkdir(join(home, '.cursor'), { recursive: true });
  await mkdir(folder);
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

async function writeCursor(extraArg = '') {
  const args = [ECHO, join(base, 'started'), ...(extraArg ? [extraArg] : [])];
  await writeFile(
    join(home, '.cursor', 'mcp.json'),
    JSON.stringify({
      mcpServers: { echo: { command: process.execPath, args, env: { ECHO_TOKEN: TOKEN } } },
    }),
  );
}

beforeEach(async () => {
  t = await createTestDb();
  secrets = memorySecretStore();
  app = createTestApp(t, { secrets, mcpHomes: scanHomesAt(home) });
  await writeCursor();
});

afterEach(async () => {
  await t.cleanup();
});

const get = (path: string) => request(app).get(path).set(LOCAL_HEADERS);
const send = (method: 'post' | 'put' | 'delete', path: string, body: object = {}) =>
  request(app)[method](path).set(LOCAL_HEADERS).set('Origin', ORIGIN).send(body);

async function scanned(): Promise<UserMcpServer> {
  const list = (await send('post', '/api/mcp/scan').expect(200)).body as UserMcpList;
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
  it('imports scanned servers switched off, with value names but never the values', async () => {
    const response = await send('post', '/api/mcp/scan').expect(200);
    const list = response.body as UserMcpList;
    expect(list.scan?.find((source) => source.tool === 'cursor')).toMatchObject({
      found: true,
      servers: 1,
    });
    const echo = list.servers[0]!;
    expect(echo).toMatchObject({
      source: 'imported:cursor',
      transport: 'stdio',
      envNames: ['ECHO_TOKEN'],
      secretNames: [],
      importableNames: ['ECHO_TOKEN'],
      global: null,
    });
    expect(JSON.stringify(response.body)).not.toContain(TOKEN);
    expect(await everythingStored()).not.toContain(TOKEN);
    expect(await loadUserMcp(t.db, await chatWith(null), [])).toEqual([]);
  });

  it('copies confirmed values into the keychain only', async () => {
    const echo = await scanned();
    const list = (
      await send('post', `/api/mcp/servers/${echo.id}/copy-secrets`, {
        fingerprint: echo.fingerprint,
        names: ['ECHO_TOKEN'],
      }).expect(200)
    ).body as UserMcpList;
    expect(list.servers[0]).toMatchObject({ secretNames: ['ECHO_TOKEN'], importableNames: [] });
    expect(await secrets.get(`mcp:${echo.id}`)).toContain(TOKEN);
    expect(await everythingStored()).not.toContain(TOKEN);
    await send('post', `/api/mcp/servers/${echo.id}/copy-secrets`, {
      fingerprint: 'stale',
      names: ['ECHO_TOKEN'],
    }).expect(409);
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
    const echo = await scanned();
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
    const echo = await scanned();
    await send('put', `/api/mcp/servers/${echo.id}/enable`, {
      scope: 'global',
      enabled: true,
      fingerprint: echo.fingerprint,
    }).expect(200);
    const chat = await chatWith(null);
    expect(await loadUserMcp(t.db, chat, [])).toHaveLength(1);

    await writeCursor('--changed');
    const changed = await scanned();
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
