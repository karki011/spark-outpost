import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, localClient } from './app-support.ts';
import {
  pairDevice,
  remoteClient,
  setSwitches,
  turnRemoteOn,
  type PairedDevice,
} from './remote-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let app: ReturnType<typeof createTestApp>;
let device: PairedDevice;
let phone: ReturnType<typeof remoteClient>;

const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/device-one';
const KEYS = {
  p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM',
  auth: 'tBHItJI5svbpez7KI4CCXg',
};

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

const subscriptions = async () =>
  (
    await t.db.query<{ device_id: string; endpoint: string; hostname: string }>(
      'SELECT device_id, endpoint, hostname FROM remote_push_subscriptions ORDER BY created_at',
    )
  ).rows;

const subscribe = (client = phone, endpoint = ENDPOINT) =>
  client.send('put', '/api/remote/push/subscription', { endpoint, keys: KEYS });

describe('the Mac switch', () => {
  it('is off by default and refuses a subscription until it is turned on', async () => {
    const session = await phone.get('/api/remote/session').expect(200);
    expect(session.body.switches.notifications).toBe(false);
    await subscribe().expect(403);
    expect(await subscriptions()).toEqual([]);

    await setSwitches(app, { notifications: true });
    const saved = await subscribe().expect(200);
    expect(saved.body.endpoints).toEqual([ENDPOINT]);
    expect(await subscriptions()).toEqual([
      { device_id: device.id, endpoint: ENDPOINT, hostname: 'mac.tail1234.ts.net' },
    ]);
  });

  it('cannot be changed from a paired device', async () => {
    await phone.send('patch', '/api/remote/switches', { notifications: true }).expect(403);
  });

  it('still lets a device turn its notifications off', async () => {
    await setSwitches(app, { notifications: true });
    await subscribe().expect(200);
    await setSwitches(app, { notifications: false });
    const after = await phone
      .send('delete', '/api/remote/push/subscription', { endpoint: ENDPOINT })
      .expect(200);
    expect(after.body.endpoints).toEqual([]);
    expect(await subscriptions()).toEqual([]);
  });
});

describe('subscribing', () => {
  beforeEach(async () => {
    await setSwitches(app, { notifications: true });
  });

  it('gives a paired device the same public key every time', async () => {
    const first = await phone.get('/api/remote/push').expect(200);
    const second = await phone.get('/api/remote/push').expect(200);
    expect(first.body.publicKey).toMatch(/^[A-Za-z0-9_-]{80,}$/);
    expect(second.body.publicKey).toBe(first.body.publicKey);
    expect(first.headers['cache-control']).toBe('no-store');
  });

  it('refuses an address that is not a browser push service', async () => {
    for (const endpoint of [
      'http://fcm.googleapis.com/fcm/send/x',
      'https://127.0.0.1:4317/api/reset',
      'https://example.com/push',
      'https://fcm.googleapis.com.evil.test/x',
      'https://user:pass@fcm.googleapis.com/x',
      'https://fcm.googleapis.com:8443/x',
    ]) {
      await subscribe(phone, endpoint).expect(400);
    }
    await subscribe(phone, 'https://web.push.apple.com/QGuQyavXutnMH').expect(200);
    await subscribe(phone, 'https://updates.push.services.mozilla.com/wpush/v2/x').expect(200);
    expect(await subscriptions()).toHaveLength(2);
  });

  it('keeps one row per endpoint when the same device subscribes again', async () => {
    await subscribe().expect(200);
    await subscribe().expect(200);
    expect(await subscriptions()).toHaveLength(1);
  });

  it('keeps the newest five subscriptions of a device', async () => {
    for (let index = 1; index <= 7; index += 1) {
      await subscribe(phone, `${ENDPOINT}-${index}`).expect(200);
    }
    const kept = (await subscriptions()).map((row) => row.endpoint);
    expect(kept).toEqual([3, 4, 5, 6, 7].map((index) => `${ENDPOINT}-${index}`));
  });

  it('lists only the asking device’s endpoints', async () => {
    const other = await pairDevice(app, 'Tablet');
    await subscribe(remoteClient(app, other.cookie), `${ENDPOINT}-tablet`).expect(200);
    await subscribe().expect(200);
    const state = await phone.get('/api/remote/push').expect(200);
    expect(state.body.endpoints).toEqual([ENDPOINT]);
  });

  it('removes only the asking device’s subscription', async () => {
    const other = await pairDevice(app, 'Tablet');
    await subscribe().expect(200);
    await remoteClient(app, other.cookie)
      .send('delete', '/api/remote/push/subscription', { endpoint: ENDPOINT })
      .expect(200);
    expect(await subscriptions()).toHaveLength(1);
  });

  it('is not a Mac route', async () => {
    await localClient(app).get('/api/remote/push').expect(404);
    await localClient(app)
      .send('put', '/api/remote/push/subscription', { endpoint: ENDPOINT, keys: KEYS })
      .expect(404);
  });

  it('needs a paired device', async () => {
    await remoteClient(app).get('/api/remote/push').expect(401);
    await subscribe(remoteClient(app)).expect(401);
  });

  it('records a subscription in the remote activity without its address or keys', async () => {
    await subscribe().expect(200);
    const { rows } = await t.db.query<{ path: string; detail: object }>(
      "SELECT path, detail FROM remote_audit WHERE action = 'request'",
    );
    expect(rows).toEqual([{ path: '/api/remote/push/subscription', detail: {} }]);
  });
});

describe('ending a device', () => {
  beforeEach(async () => {
    await setSwitches(app, { notifications: true });
    await subscribe().expect(200);
  });

  it('deletes its subscriptions when it is revoked', async () => {
    await localClient(app).send('delete', `/api/remote/devices/${device.id}`).expect(200);
    expect(await subscriptions()).toEqual([]);
  });

  it('deletes every subscription on Disconnect all', async () => {
    const other = await pairDevice(app, 'Tablet');
    await subscribe(remoteClient(app, other.cookie), `${ENDPOINT}-tablet`).expect(200);
    await localClient(app).send('post', '/api/remote/devices/disconnect-all').expect(200);
    expect(await subscriptions()).toEqual([]);
  });

  it('deletes the old row’s subscriptions when a revoked device pairs again', async () => {
    await localClient(app).send('delete', `/api/remote/devices/${device.id}`).expect(200);
    await subscribe().expect(401);
    const again = await pairDevice(app, 'Test phone', undefined, device.cookie);
    expect(again.id).not.toBe(device.id);
    expect(await subscriptions()).toEqual([]);
  });

  it('keeps them when the device pairs again over a valid cookie', async () => {
    const again = await pairDevice(app, 'Test phone', undefined, device.cookie);
    expect(again.id).toBe(device.id);
    expect(await subscriptions()).toHaveLength(1);
  });
});

describe('focus from a paired device', () => {
  it('is reported without filling the remote activity', async () => {
    for (const focused of [true, false, true, true, false]) {
      await phone.send('post', '/api/slack/presence', { focused }).expect(204);
    }
    await phone.send('post', '/api/slack/presence/', { focused: true }).expect(204);
    const { rows } = await t.db.query("SELECT 1 FROM remote_audit WHERE action = 'request'");
    expect(rows).toEqual([]);
  });
});
