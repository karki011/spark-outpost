import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

const TARGET = `http://127.0.0.1:${PORT}`;
const ADDRESS = `https://${FAKE_TAILSCALE_HOST}`;

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
const state = async () => (await local().get('/api/remote/tailscale').expect(200)).body;
const turn = async (to: 'on' | 'off') =>
  (await local().send('post', `/api/remote/tailscale/${to}`).expect(200)).body;
const hostname = async () => (await local().get('/api/remote/access').expect(200)).body.hostname;
const serveCalls = () =>
  tailscale.calls.filter((args) => args[0] === 'serve' && args[1] !== 'status');

beforeEach(async () => {
  t = await createTestDb();
});

afterEach(async () => {
  await t.cleanup();
});

describe('Tailscale state', () => {
  it('says not installed when there is no CLI', async () => {
    start({ installed: false });
    expect(await state()).toEqual({
      status: 'not_installed',
      hostname: null,
      address: null,
      message: null,
    });
  });

  it('says signed out when the backend is not running', async () => {
    start({ backendState: 'NeedsLogin' });
    expect((await state()).status).toBe('signed_out');
  });

  it('says HTTPS is off when the tailnet has no certificate domains', async () => {
    start({ httpsEnabled: false });
    expect(await state()).toMatchObject({ status: 'https_off', hostname: FAKE_TAILSCALE_HOST });
  });

  it('is off until turned on, and names the address it would use', async () => {
    start();
    expect(await state()).toEqual({
      status: 'off',
      hostname: FAKE_TAILSCALE_HOST,
      address: null,
      message: null,
    });
  });

  it('refuses to turn on in a state that is not ready', async () => {
    start({ backendState: 'Stopped' });
    expect((await turn('on')).status).toBe('signed_out');
    expect(await hostname()).toBeNull();
    expect(serveCalls()).toEqual([]);
  });
});

describe('turning Serve on and off', () => {
  it('serves the local port, saves the hostname and returns the address', async () => {
    start();
    expect(await turn('on')).toEqual({
      status: 'on',
      hostname: FAKE_TAILSCALE_HOST,
      address: ADDRESS,
      message: null,
    });
    expect(await hostname()).toBe(FAKE_TAILSCALE_HOST);
    expect(serveCalls()).toEqual([['serve', '--bg', '--https=443', TARGET]]);
    expect(tailscale.calls.flat()).not.toContain('funnel');
    expect((await state()).status).toBe('on');
  });

  it('closes remote access when turned off and removes its own handler', async () => {
    start();
    await turn('on');
    const device = await pairDevice(app, 'Test phone', FAKE_TAILSCALE_HOST);
    await remoteClient(app, device.cookie, FAKE_TAILSCALE_HOST)
      .get('/api/conversations')
      .expect(200);

    expect((await turn('off')).status).toBe('off');
    expect(await hostname()).toBeNull();
    expect(tailscale.handler).toBeNull();
    await remoteClient(app, device.cookie, FAKE_TAILSCALE_HOST)
      .get('/api/conversations')
      .expect(403);
  });

  it('leaves the hostname unchanged when the CLI fails to turn on', async () => {
    start({ failServe: true });
    const result = await turn('on');
    expect(result.status).toBe('error');
    expect(result.message).toContain('could not be turned on');
    expect(await hostname()).toBeNull();
  });

  it('still closes remote access when the CLI fails to turn off', async () => {
    start();
    await turn('on');
    tailscale.failServe = true;
    expect((await turn('off')).status).toBe('error');
    expect(await hostname()).toBeNull();
  });

  it('does not replace or remove a handler it did not add', async () => {
    start({ handler: 'http://127.0.0.1:3000' });
    expect((await turn('on')).status).toBe('error');
    expect(await hostname()).toBeNull();
    await turn('off');
    expect(tailscale.handler).toBe('http://127.0.0.1:3000');
    expect(serveCalls()).toEqual([]);
  });

  it('refuses to turn on while Funnel is on for the address', async () => {
    start({ funnel: true, handler: TARGET });
    const result = await turn('on');
    expect(result.status).toBe('error');
    expect(result.message).toContain('Funnel');
    expect(await hostname()).toBeNull();
  });

  it('reports an error when Serve stops pointing at Spark while on', async () => {
    start();
    await turn('on');
    tailscale.handler = null;
    expect((await state()).status).toBe('error');
  });

  it('is not reachable from a paired phone', async () => {
    start();
    await turn('on');
    const device = await pairDevice(app, 'Test phone', FAKE_TAILSCALE_HOST);
    const phone = remoteClient(app, device.cookie, FAKE_TAILSCALE_HOST);
    await phone.get('/api/remote/tailscale').expect(403);
    await phone.send('post', '/api/remote/tailscale/off').expect(403);
    expect(await hostname()).toBe(FAKE_TAILSCALE_HOST);
  });
});

describe('checking Serve at startup', () => {
  it('keeps phone access when Serve still points at this port', async () => {
    start();
    await turn('on');
    await restart().reconcileRemote();
    expect(await hostname()).toBe(FAKE_TAILSCALE_HOST);
  });

  it('points Serve at the new port when the port changed between launches', async () => {
    start();
    await turn('on');
    tailscale.handler = 'http://127.0.0.1:5999';
    await t.db.query(`UPDATE remote_access_settings SET serve_target = 'http://127.0.0.1:5999'`);
    await restart().reconcileRemote();
    expect(tailscale.handler).toBe(TARGET);
    expect(await hostname()).toBe(FAKE_TAILSCALE_HOST);
    expect((await state()).status).toBe('on');
  });

  it('turns phone access off and says so when Serve no longer points at Spark', async () => {
    start();
    await turn('on');
    tailscale.handler = null;
    const next = restart();
    await next.reconcileRemote();
    app = next.app;
    expect(await hostname()).toBeNull();
    expect(await state()).toMatchObject({ status: 'off' });
    expect((await state()).message).toContain('turned off');
  });

  it('leaves the setting alone when Tailscale does not answer', async () => {
    start();
    await turn('on');
    tailscale.backendState = 'Stopped';
    await restart().reconcileRemote();
    expect(await hostname()).toBe(FAKE_TAILSCALE_HOST);
  });
});
