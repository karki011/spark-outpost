import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { REMOTE_SWITCH_DEFAULTS } from '@spark-outpost/contracts';
import { insertApproval } from '../src/persistence/approvals.ts';
import { ROUTE_RULES } from '../src/remote/route-rules.ts';
import { createTestApp, localClient } from './app-support.ts';
import { doRun } from './approval-support.ts';
import { registeredRoutes } from './remote-routes-support.ts';
import {
  pairDevice,
  remoteClient,
  setSwitches,
  turnRemoteOn,
  type PairedDevice,
} from './remote-support.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

const WEB_APP_ROUTE = 'GET /{*path}';

let t: TestDb;
let app: ReturnType<typeof createTestApp>;
let device: PairedDevice;
let phone: ReturnType<typeof remoteClient>;
let root: string;

beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'spark-remote-policy-')));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

beforeEach(async () => {
  t = await createTestDb();
  app = createTestApp(t);
  await turnRemoteOn(app);
  device = await pairDevice(app);
  phone = remoteClient(app, device.cookie);
});

afterEach(async () => {
  await t.cleanup();
});

const refusals = async () =>
  (
    await t.db.query<{ path: string; device_id: string; detail: { reason: string } }>(
      `SELECT path, device_id, detail FROM remote_audit WHERE action = 'refused' ORDER BY created_at, id`,
    )
  ).rows;

describe('route classification', () => {
  it('has a decision for every route the server registers', () => {
    const unclassified = registeredRoutes(app).filter((route) => !ROUTE_RULES.has(route));
    expect(unclassified).toEqual([]);
  });

  it('has no rule for a route that no longer exists', () => {
    const registered = new Set([...registeredRoutes(app), WEB_APP_ROUTE]);
    const stale = [...ROUTE_RULES.keys()].filter((route) => !registered.has(route));
    expect(stale).toEqual([]);
  });

  it('classifies the web app itself', () => {
    expect(ROUTE_RULES.get(WEB_APP_ROUTE)).toBe('always');
  });

  it('refuses an unknown route with 403 and records it', async () => {
    await phone.get('/api/not-a-route').expect(403);
    expect(await refusals()).toEqual([
      { path: '/api/not-a-route', device_id: device.id, detail: { reason: 'policy' } },
    ]);
  });
});

describe('never from a phone', () => {
  it('refuses terminal, preview, diagnostics and phone access management', async () => {
    const id = crypto.randomUUID();
    await phone.send('post', '/api/terminal/sessions').expect(403);
    await phone.send('post', '/api/terminal/shells').expect(403);
    await phone.send('delete', `/api/terminal/sessions/${id}`).expect(403);
    await phone.get(`/api/terminal/sessions/${id}/busy`).expect(403);
    await phone.send('post', `/api/conversations/${id}/preview/start`).expect(403);
    await phone.get(`/api/conversations/${id}/preview`).expect(403);
    await phone.send('post', `/api/conversations/${id}/workspace/open`).expect(403);
    await phone.get('/api/diagnostics/export').expect(403);
    await phone.get('/api/instructions-file?path=/etc/hosts').expect(403);
    await phone.get('/api/remote/access').expect(403);
    await phone.get('/api/remote/devices').expect(403);
    await phone.get('/api/remote/audit').expect(403);
    await phone.send('delete', `/api/remote/devices/${device.id}`).expect(403);
    await phone.send('post', '/api/remote/devices/disconnect-all').expect(403);
    await phone.send('put', '/api/remote/access', { hostname: 'evil.example.com' }).expect(403);
    await phone.send('post', '/API/Terminal/Sessions/').expect(403);
  });

  it('keeps those refused with every switch on', async () => {
    await setSwitches(app, {
      settings: true,
      connections: true,
      projects: true,
      agentMode: true,
      highRiskCards: true,
      signIns: true,
      reset: true,
      devices: true,
    });
    await phone.send('post', '/api/terminal/sessions').expect(403);
    await phone.send('post', '/api/remote/pairings').expect(403);
    await phone.get('/api/remote/devices').expect(403);
    await phone.send('patch', '/api/remote/switches', { reset: false }).expect(403);
  });
});

describe('switches', () => {
  it('start at the proposed defaults and can be read from a phone', async () => {
    expect((await phone.get('/api/remote/switches').expect(200)).body).toEqual(
      REMOTE_SWITCH_DEFAULTS,
    );
    expect((await localClient(app).get('/api/remote/access').expect(200)).body).toMatchObject({
      switches: REMOTE_SWITCH_DEFAULTS,
    });
  });

  it('cannot be written from a phone', async () => {
    await phone.send('patch', '/api/remote/switches', { reset: true }).expect(403);
    expect((await phone.get('/api/remote/switches')).body.reset).toBe(false);
    await localClient(app).send('patch', '/api/remote/switches', { reset: true }).expect(200);
    expect((await phone.get('/api/remote/switches')).body.reset).toBe(true);
    await localClient(app).send('patch', '/api/remote/switches', {}).expect(400);
    await localClient(app).send('patch', '/api/remote/switches', { other: true }).expect(400);
  });

  it('settings: profile changes', async () => {
    await phone.send('patch', '/api/profile', { name: 'Hari' }).expect(200);
    await setSwitches(app, { settings: false });
    await phone.send('patch', '/api/profile', { name: 'Other' }).expect(403);
  });

  it('connections: provider and MCP changes', async () => {
    const before = await phone.send('delete', '/api/providers/claude/connection');
    expect(before.status).not.toBe(403);
    await setSwitches(app, { connections: false });
    await phone.send('delete', '/api/providers/claude/connection').expect(403);
    await phone.send('post', '/api/mcp/servers', {}).expect(403);
    await phone.get('/api/mcp/servers').expect(200);
  });

  it('projects: folder listing and linking', async () => {
    await phone.get(`/api/folders?path=${encodeURIComponent(root)}`).expect(200);
    expect((await phone.send('post', '/api/projects', { path: root })).status).not.toBe(403);
    await setSwitches(app, { projects: false });
    await phone.get(`/api/folders?path=${encodeURIComponent(root)}`).expect(403);
    await phone.send('post', '/api/projects', { path: root }).expect(403);
    await phone.get('/api/projects').expect(200);
  });

  it('agent mode: mode and autonomy fields on chat settings', async () => {
    const id = crypto.randomUUID();
    await phone.send('post', '/api/conversations', { id }).expect(201);
    const settings = `/api/conversations/${id}/settings`;
    expect((await phone.send('patch', settings, { level: 'full-auto' })).status).not.toBe(403);
    await setSwitches(app, { agentMode: false });
    await phone.send('patch', settings, { level: 'hands-off' }).expect(403);
    await phone.send('patch', settings, { agentMode: 'auto' }).expect(403);
    await phone.send('patch', settings, { permission: 'do' }).expect(403);
    await phone.send('patch', settings, { projectIds: [] }).expect(200);
    const local = await localClient(app).send('patch', settings, { level: 'hands-off' });
    expect(local.status).not.toBe(403);
    expect((await refusals()).at(-1)).toMatchObject({ detail: { reason: 'switch:agentMode' } });
  });

  it('high-risk cards: git control cards and rail flags', async () => {
    const { runId } = await doRun(t, root);
    const card = (toolCallId: string, payload: object) =>
      insertApproval(t.db, {
        runId,
        toolCallId,
        rpcId: null,
        kind: 'execute',
        title: 'card',
        payload: { command: 'x', cwd: root, paths: [], diffs: [], truncated: false, ...payload },
        options: [
          { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
          { optionId: 'reject', name: 'Deny', kind: 'reject_once' },
        ],
        reason: null,
      });
    const allow = { optionId: 'allow', scope: 'once' };
    const first = await card('hooks-1', { gitControl: ['.git/hooks/pre-commit'] });
    await phone.send('post', `/api/approvals/${first.id}/decision`, allow).expect(200);

    await setSwitches(app, { highRiskCards: false });
    const second = await card('hooks-2', { gitControl: ['.git/config'] });
    const secret = await card('secret', { paths: ['.env'] });
    const ordinary = await card('ordinary', {});
    await phone.send('post', `/api/approvals/${second.id}/decision`, allow).expect(403);
    await phone.send('post', `/api/approvals/${secret.id}/decision`, allow).expect(403);
    await phone.send('post', `/api/approvals/${ordinary.id}/decision`, allow).expect(200);
    await phone
      .send('post', `/api/rail-flags/${crypto.randomUUID()}/decision`, { decision: 'keep' })
      .expect(403);
    await localClient(app).send('post', `/api/approvals/${second.id}/decision`, allow).expect(200);
  });

  it('sign-ins: off by default, reads stay open', async () => {
    const id = crypto.randomUUID();
    await phone.send('post', `/api/projects/${id}/sign-ins`, {}).expect(403);
    await phone.send('delete', `/api/projects/${id}/sign-ins/${id}`).expect(403);
    await setSwitches(app, { signIns: true });
    const allowed = await phone.send('post', `/api/projects/${id}/sign-ins`, {});
    expect(allowed.status).not.toBe(403);
  });

  it('reset: off by default for reset and deleting chats', async () => {
    const id = crypto.randomUUID();
    await phone.send('post', '/api/conversations', { id }).expect(201);
    await phone.send('post', '/api/reset', { keepApiKeys: true }).expect(403);
    await phone.send('delete', `/api/conversations/${id}`).expect(403);
    await phone.get(`/api/conversations/${id}`).expect(200);
    await setSwitches(app, { reset: true });
    const deleted = await phone.send('delete', `/api/conversations/${id}`);
    expect(deleted.status).not.toBe(403);
  });
});

describe('audit', () => {
  it('records each state-changing request with the device, and no reads', async () => {
    const id = crypto.randomUUID();
    await phone.get('/api/conversations').expect(200);
    await phone.send('post', '/api/conversations', { id }).expect(201);
    await phone.send('patch', `/api/conversations/${id}`, { title: 'From my phone' }).expect(200);
    const rows = await eventually(async () => {
      const found = await t.db.query(
        `SELECT method, path, status, device_id, device_name FROM remote_audit
         WHERE action = 'request' ORDER BY created_at, id`,
      );
      return found.rows.every((row) => row.status !== null) ? found.rows : null;
    });
    expect(rows).toEqual([
      {
        method: 'POST',
        path: '/api/conversations',
        status: 201,
        device_id: device.id,
        device_name: 'Test phone',
      },
      {
        method: 'PATCH',
        path: `/api/conversations/${id}`,
        status: 200,
        device_id: device.id,
        device_name: 'Test phone',
      },
    ]);
  });

  it('lists the trail for the Mac, newest first, without request bodies', async () => {
    await phone.send('post', '/api/terminal/sessions', { secretish: 'value-in-body' }).expect(403);
    const listed = await localClient(app).get('/api/remote/audit').expect(200);
    expect(listed.body.entries[0]).toMatchObject({
      action: 'refused',
      deviceId: device.id,
      deviceName: 'Test phone',
      method: 'POST',
      path: '/api/terminal/sessions',
      status: 403,
    });
    expect(JSON.stringify(listed.body)).not.toContain('value-in-body');
  });
});
