import http from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CUSTOM_DOMAIN_PROBLEMS, remoteAccessSchema } from '@spark-outpost/contracts';
import { createAppParts } from '../src/api/app.ts';
import { createTestApp, localClient, PORT, testAppOptions } from './app-support.ts';
import {
  FAKE_TAILSCALE_HOST,
  fakeTailscaleRunner,
  fakeTailscaleState,
  type FakeTailscaleState,
} from './fake-tailscale.ts';
import { pairDevice, remoteClient } from './remote-support.ts';
import { createTestDb, type TestDb } from './support.ts';

const CUSTOM = 'spark.example.com';
const TARGET = `http://127.0.0.1:${PORT}`;

let t: TestDb;
let tailscale: FakeTailscaleState;
let app: ReturnType<typeof createTestApp>;

const start = (change: Partial<FakeTailscaleState> = {}) => {
  tailscale = fakeTailscaleState(change);
  app = createTestApp(t, { runCommand: fakeTailscaleRunner(tailscale) });
};

const restart = () =>
  createAppParts(testAppOptions(t, { runCommand: fakeTailscaleRunner(tailscale) }));

const local = () => localClient(app);
const put = (body: object) => local().send('put', '/api/remote/access', body);
const access = async () =>
  remoteAccessSchema.parse((await local().get('/api/remote/access').expect(200)).body);
const tailscaleState = async () => (await local().get('/api/remote/tailscale').expect(200)).body;
const turn = async (to: 'on' | 'off') =>
  (await local().send('post', `/api/remote/tailscale/${to}`).expect(200)).body;
const serveCalls = () =>
  tailscale.calls.filter((args) => args[0] === 'serve' && args[1] !== 'status');
const hostnameAudits = async () => {
  const { rows } = await t.db.query<{ detail: Record<string, unknown> }>(
    `SELECT detail FROM remote_audit WHERE action = 'hostname_changed' ORDER BY created_at, id`,
  );
  return rows.map((row) => row.detail);
};

beforeEach(async () => {
  t = await createTestDb();
  start();
});

afterEach(async () => {
  await t.cleanup();
});

describe('setting a custom domain', () => {
  it('starts at Tailscale reach and names the address a proxy forwards to', async () => {
    expect(await access()).toMatchObject({ hostname: null, reach: 'tailscale', forwardTo: TARGET });
  });

  it('refuses a Tailscale name', async () => {
    const refused = await put({ hostname: FAKE_TAILSCALE_HOST, confirmed: true }).expect(400);
    expect(refused.body).toEqual({ error: CUSTOM_DOMAIN_PROBLEMS.tailscale, problem: 'tailscale' });
    expect(await access()).toMatchObject({ hostname: null, reach: 'tailscale' });
  });

  it('refuses a domain that was not confirmed', async () => {
    for (const body of [{ hostname: CUSTOM }, { hostname: CUSTOM, confirmed: false }]) {
      const refused = await put(body).expect(400);
      expect(refused.body).toEqual({
        error: CUSTOM_DOMAIN_PROBLEMS.unconfirmed,
        problem: 'unconfirmed',
      });
    }
    expect(await access()).toMatchObject({ hostname: null, reach: 'tailscale' });
    expect(await hostnameAudits()).toEqual([]);
  });

  it('saves a confirmed domain, answers with it and records the reach, not the name', async () => {
    const saved = await put({ hostname: CUSTOM, confirmed: true }).expect(200);
    expect(remoteAccessSchema.parse(saved.body)).toMatchObject({
      hostname: CUSTOM,
      reach: 'custom',
      forwardTo: TARGET,
    });
    expect(await access()).toMatchObject({ hostname: CUSTOM, reach: 'custom', forwardTo: TARGET });
    expect(await hostnameAudits()).toEqual([{ on: true, reach: 'custom' }]);
    expect(JSON.stringify(await hostnameAudits())).not.toContain(CUSTOM);
    expect(serveCalls()).toEqual([]);
  });

  it('turns off the Serve handler Spark added before saving the domain', async () => {
    await turn('on');
    const phone = await pairDevice(app, 'Test phone', FAKE_TAILSCALE_HOST);
    await put({ hostname: CUSTOM, confirmed: true }).expect(200);
    expect(tailscale.handler).toBeNull();
    expect(serveCalls().at(-1)).toEqual(['serve', '--https=443', 'off']);
    expect(await access()).toMatchObject({ hostname: CUSTOM, reach: 'custom' });
    await remoteClient(app, phone.cookie, FAKE_TAILSCALE_HOST)
      .get('/api/conversations')
      .expect(403);
  });

  it('leaves a Serve handler it did not add', async () => {
    start({ handler: 'http://127.0.0.1:3000' });
    await put({ hostname: CUSTOM, confirmed: true }).expect(200);
    expect(tailscale.handler).toBe('http://127.0.0.1:3000');
    expect(serveCalls()).toEqual([]);
  });

  it('still saves the domain when Tailscale does not answer', async () => {
    start({ installed: false });
    await put({ hostname: CUSTOM, confirmed: true }).expect(200);
    expect(await access()).toMatchObject({ hostname: CUSTOM, reach: 'custom' });
  });

  it('cannot be read or changed from a paired device', async () => {
    await put({ hostname: CUSTOM, confirmed: true }).expect(200);
    const device = await pairDevice(app, 'Test phone', CUSTOM);
    const phone = remoteClient(app, device.cookie, CUSTOM);
    await phone.get('/api/remote/access').expect(403);
    await phone
      .send('put', '/api/remote/access', { hostname: 'evil.example.com', confirmed: true })
      .expect(403);
    expect((await access()).hostname).toBe(CUSTOM);
  });
});

describe('requests at a custom domain', () => {
  beforeEach(async () => {
    await put({ hostname: CUSTOM, confirmed: true }).expect(200);
  });

  it('admits its Host and Origin as a paired device and refuses any other Host', async () => {
    const device = await pairDevice(app, 'Test phone', CUSTOM);
    const session = await remoteClient(app, device.cookie, CUSTOM)
      .get('/api/remote/session')
      .expect(200);
    expect(session.body).toMatchObject({ remote: true, address: `https://${CUSTOM}` });
    await remoteClient(app, device.cookie, CUSTOM)
      .send('post', '/api/conversations', { id: crypto.randomUUID() })
      .expect(201);

    for (const host of [FAKE_TAILSCALE_HOST, 'other.example.com', `${CUSTOM}:443`]) {
      await request(app)
        .get('/api/conversations')
        .set({ Host: host, Cookie: device.cookie })
        .expect(403);
    }
    await request(app)
      .post('/api/conversations')
      .set({ Host: CUSTOM, Cookie: device.cookie, Origin: 'https://other.example.com' })
      .send({ id: crypto.randomUUID() })
      .expect(403);
  });

  it('closes every stream when the domain changes or is cleared', async () => {
    const device = await pairDevice(app, 'Test phone', CUSTOM);
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const closed = new Promise<void>((resolve, reject) => {
        http
          .get(
            {
              host: '127.0.0.1',
              port,
              path: '/api/events',
              headers: { Host: CUSTOM, Cookie: device.cookie, Accept: 'text/event-stream' },
            },
            (res) => {
              res.resume();
              res.once('close', () => resolve());
              void put({ hostname: null }).then();
            },
          )
          .on('error', reject);
      });
      await closed;
      await remoteClient(app, device.cookie, CUSTOM).get('/api/conversations').expect(403);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

describe('Tailscale beside a custom domain', () => {
  beforeEach(async () => {
    await put({ hostname: CUSTOM, confirmed: true }).expect(200);
  });

  it('reports Tailscale as off and never the custom name as a Serve address', async () => {
    expect(await tailscaleState()).toEqual({
      status: 'off',
      hostname: FAKE_TAILSCALE_HOST,
      address: null,
      message: null,
    });
    expect((await access()).hostname).toBe(CUSTOM);
  });

  it('keeps the domain through the check at start, whatever Serve shows', async () => {
    for (const change of [
      { handler: null },
      { handler: 'http://127.0.0.1:3000' },
      { funnel: true },
    ]) {
      Object.assign(tailscale, change);
      const next = restart();
      await next.reconcileRemote();
      app = next.app;
      expect(await access()).toMatchObject({ hostname: CUSTOM, reach: 'custom' });
      expect((await tailscaleState()).message).toBeNull();
    }
    expect(serveCalls()).toEqual([]);
  });

  it('keeps the domain when Tailscale is turned off', async () => {
    expect((await turn('off')).status).toBe('off');
    expect(await access()).toMatchObject({ hostname: CUSTOM, reach: 'custom' });
  });

  it('switches back to Tailscale when it is turned on', async () => {
    const device = await pairDevice(app, 'Test phone', CUSTOM);
    expect(await turn('on')).toMatchObject({ status: 'on', hostname: FAKE_TAILSCALE_HOST });
    expect(await access()).toMatchObject({ hostname: FAKE_TAILSCALE_HOST, reach: 'tailscale' });
    expect(tailscale.handler).toBe(TARGET);
    await remoteClient(app, device.cookie, CUSTOM).get('/api/conversations').expect(403);
    expect((await hostnameAudits()).at(-1)).toEqual({
      on: true,
      reason: 'turned_on',
      reach: 'tailscale',
    });
  });

  it('clears back to Tailscale reach without touching Serve', async () => {
    tailscale.handler = TARGET;
    tailscale.calls.length = 0;
    const cleared = await put({ hostname: null }).expect(200);
    expect(cleared.body).toMatchObject({ hostname: null, reach: 'tailscale', forwardTo: TARGET });
    expect(tailscale.calls).toEqual([]);
    expect(tailscale.handler).toBe(TARGET);
    expect((await hostnameAudits()).at(-1)).toEqual({ on: false, reach: 'tailscale' });
  });
});
