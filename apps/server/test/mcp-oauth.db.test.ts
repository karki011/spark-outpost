import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { McpSignInFlow, UserMcpList, UserMcpServer } from '@spark-outpost/contracts';
import type { McpServerConfig } from '../src/agent-config/mcp-json.ts';
import { launchOf, resolveUserServer } from '../src/mcp/launch.ts';
import { createMcpOAuth, type McpOAuth } from '../src/mcp/oauth.ts';
import type { ProbeResult } from '../src/mcp/probe.ts';
import { getUserMcp } from '../src/mcp/store.ts';
import { mcpOAuthSecret, memorySecretStore, type SecretStore } from '../src/setup/secrets.ts';
import { createApp } from '../src/api/app.ts';
import { LOCAL_HEADERS, ORIGIN, testAppOptions } from './app-support.ts';
import { fakeMcpAuth, type FakeMcpAuth } from './fake-mcp-auth.ts';
import { createTestDb, type TestDb } from './support.ts';

const HOUR = 60 * 60_000;

let t: TestDb;
let fake: FakeMcpAuth;
let secrets: SecretStore;
let oauth: McpOAuth;
let app: ReturnType<typeof createApp>;
let clock = Date.parse('2026-12-01T10:00:00Z');
let probed: McpServerConfig[] = [];

const service = () => createMcpOAuth({ db: t.db, secrets, now: () => clock });

async function probeMcp(server: McpServerConfig): Promise<ProbeResult> {
  probed.push(server);
  if (fake.accepts(server.headers.Authorization))
    return { ok: true, tools: ['search'], error: null };
  return { ok: false, tools: [], error: 'HTTP 401', unauthorized: true };
}

beforeEach(async () => {
  t = await createTestDb();
  fake = await fakeMcpAuth();
  secrets = memorySecretStore();
  oauth = service();
  probed = [];
  app = createApp({ ...testAppOptions(t, { secrets }), probeMcp, mcpOAuth: oauth });
});

afterEach(async () => {
  await fake.close();
  await t.cleanup();
});

const get = (path: string) => request(app).get(path).set(LOCAL_HEADERS);
const send = (method: 'post' | 'put' | 'delete', path: string, body: object = {}) =>
  request(app)[method](path).set(LOCAL_HEADERS).set('Origin', ORIGIN).send(body);

const remoteBody = (url = fake.serverUrl) => ({
  name: 'notes',
  transport: 'http',
  command: null,
  args: [],
  url,
  env: {},
  headers: {},
});

async function listed(): Promise<UserMcpServer> {
  const list = (await get('/api/mcp/servers').expect(200)).body as UserMcpList;
  return list.servers[0]!;
}

async function added(): Promise<UserMcpServer> {
  await send('post', '/api/mcp/servers', remoteBody()).expect(201);
  return listed();
}

async function signedIn(): Promise<UserMcpServer> {
  const server = await added();
  const flow = (await send('post', `/api/mcp/servers/${server.id}/sign-in`).expect(200))
    .body as McpSignInFlow;
  await fake.authorize(flow.authorizeUrl!);
  await oauth.settled(server.id);
  return listed();
}

const target = (server: UserMcpServer) => ({ id: server.id, url: server.url! });
const refreshes = () =>
  fake.tokenRequests.filter((form) => form.get('grant_type') === 'refresh_token').length;

describe('Signing in to an MCP server', () => {
  it('offers a sign-in once a test is refused for missing sign-in', async () => {
    const server = await added();
    expect(server.signIn).toBe('none');
    await send('post', `/api/mcp/servers/${server.id}/test`).expect(200);
    expect(await listed()).toMatchObject({ signIn: 'needed', check: { ok: false } });
  });

  it('signs in with PKCE through a loopback address and keeps it in the keychain only', async () => {
    const server = await signedIn();
    expect(server.signIn).toBe('signed_in');
    expect(fake.registrations).toHaveLength(1);
    expect(fake.registrations[0]!.redirect_uris[0]).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(fake.tokenRequests[0]!.get('code_verifier')).toBeTruthy();
    const saved = await secrets.get(mcpOAuthSecret(server.id));
    expect(saved).toContain('refresh-1');
    const flow = (await get(`/api/mcp/servers/${server.id}/sign-in`).expect(200)).body;
    expect(flow).toMatchObject({ status: 'connected', authorizeUrl: null });
    const row = await t.db.query('SELECT to_jsonb(s) AS row FROM mcp_servers s');
    expect(JSON.stringify([row.rows, server])).not.toMatch(/access-1|refresh-1/);
  });

  it('refuses an answer with the wrong state', async () => {
    const server = await added();
    const flow = await oauth.start(target(server));
    const asked = new URL(flow.authorizeUrl!);
    const back = new URL(asked.searchParams.get('redirect_uri')!);
    back.searchParams.set('code', 'stolen');
    back.searchParams.set('state', 'someone-else');
    await fetch(back);
    expect(oauth.flow(server.id).status).toBe('failed');
    expect((await listed()).signIn).toBe('none');
  });

  it('has no sign-in for a server started by a command', async () => {
    await send('post', '/api/mcp/servers', {
      ...remoteBody(),
      transport: 'stdio',
      command: 'node',
      url: null,
    }).expect(201);
    const server = await listed();
    await send('post', `/api/mcp/servers/${server.id}/sign-in`).expect(400);
  });
});

describe('Using a saved MCP sign-in', () => {
  it('sends the token to the server on Test and to an agent at launch', async () => {
    const server = await signedIn();
    await send('post', `/api/mcp/servers/${server.id}/test`).expect(200);
    expect(await listed()).toMatchObject({ signIn: 'signed_in', check: { ok: true } });
    const row = (await getUserMcp(t.db, t.workspaceId, server.id))!;
    const launched = await resolveUserServer(launchOf(row), secrets, oauth.bearer);
    expect(launched.headers).toEqual({ Authorization: 'Bearer access-1' });
  });

  it('reuses the token, then renews it without asking and saves the new refresh token', async () => {
    const server = await signedIn();
    expect(await oauth.bearer(target(server))).toBe('access-1');
    expect(refreshes()).toBe(0);
    clock += HOUR;
    expect(await oauth.bearer(target(server))).toBe('access-2');
    expect(await secrets.get(mcpOAuthSecret(server.id))).toContain('refresh-2');
    expect(fake.registrations).toHaveLength(1);
  });

  it('stays signed in after a restart, from the keychain alone', async () => {
    const server = await signedIn();
    clock += HOUR;
    expect(await service().bearer(target(server))).toBe('access-2');
    expect((await listed()).signIn).toBe('signed_in');
  });

  it('renews once when the API and the chat worker both need a new token', async () => {
    const server = await signedIn();
    clock += HOUR;
    const tokens = await Promise.all([
      service().bearer(target(server)),
      service().bearer(target(server)),
    ]);
    expect(tokens).toEqual(['access-2', 'access-2']);
    expect(refreshes()).toBe(1);
  });

  it('keeps a refresh token the server does not rotate', async () => {
    fake.rotate = false;
    const server = await signedIn();
    clock += HOUR;
    await oauth.bearer(target(server));
    clock += HOUR;
    expect(await oauth.bearer(target(server))).toBe('access-3');
    expect(fake.refreshTokens).toEqual(['refresh-1']);
  });

  it('keeps the sign-in when a renewal cannot reach the server', async () => {
    const server = await signedIn();
    clock += HOUR;
    fake.goOffline();
    expect(await oauth.bearer(target(server))).toBe('access-1');
    expect((await listed()).signIn).toBe('signed_in');
  });

  it('asks to sign in again only when the server refuses the saved sign-in', async () => {
    const server = await signedIn();
    fake.refuseRefresh();
    clock += HOUR;
    expect(await oauth.bearer(target(server))).toBeNull();
    expect((await listed()).signIn).toBe('needed');
  });

  it('renews and tests again when the server refuses a token Spark thought was good', async () => {
    const server = await signedIn();
    fake.expiresIn = 3600;
    await service().bearer(target(server), { renew: true });
    await send('post', `/api/mcp/servers/${server.id}/test`).expect(200);
    expect(await listed()).toMatchObject({ signIn: 'signed_in', check: { ok: true } });
  });
});

describe('Forgetting an MCP sign-in', () => {
  it('signs out on request', async () => {
    const server = await signedIn();
    await send('post', `/api/mcp/servers/${server.id}/sign-out`).expect(200);
    expect(await secrets.get(mcpOAuthSecret(server.id))).toBeNull();
    expect((await listed()).signIn).toBe('none');
  });

  it('forgets the sign-in when the address changes', async () => {
    const server = await signedIn();
    await send('put', `/api/mcp/servers/${server.id}`, remoteBody(`${fake.baseUrl}/other`)).expect(
      200,
    );
    expect(await secrets.get(mcpOAuthSecret(server.id))).toBeNull();
    expect((await listed()).signIn).toBe('none');
  });

  it('forgets the sign-in when the server is removed', async () => {
    const server = await signedIn();
    await send('delete', `/api/mcp/servers/${server.id}`).expect(200);
    expect(await secrets.get(mcpOAuthSecret(server.id))).toBeNull();
  });
});
