import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, localClient } from './app-support.ts';
import {
  REMOTE_HOST,
  pairDevice,
  remoteClient,
  setSwitches,
  turnRemoteOn,
} from './remote-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let app: ReturnType<typeof createTestApp>;

beforeEach(async () => {
  t = await createTestDb();
  app = createTestApp(t);
  await turnRemoteOn(app);
});

afterEach(async () => {
  await t.cleanup();
});

interface ListedDevice {
  id: string;
  revokedAt: string | null;
}

const listedDevices = async () => {
  const listed = await localClient(app).get('/api/remote/devices').expect(200);
  return new Map(
    (listed.body.devices as ListedDevice[]).map((device) => [device.id, device.revokedAt]),
  );
};

const revokedAudit = async () =>
  (
    await t.db.query<{
      device_id: string | null;
      device_name: string | null;
      detail: Record<string, unknown>;
    }>(
      `SELECT device_id, device_name, detail FROM remote_audit
       WHERE action = 'device_revoked' ORDER BY created_at, id`,
    )
  ).rows;

describe('a device ending its own session', () => {
  it('revokes the calling device, which is refused on its next request', async () => {
    const device = await pairDevice(app, 'Other Mac');
    const ended = await remoteClient(app, device.cookie)
      .send('post', '/api/remote/session/end')
      .expect(204);
    expect(ended.text).toBe('');

    const refused = await remoteClient(app, device.cookie).get('/api/conversations').expect(401);
    expect(refused.body).toEqual({ error: 'This device needs to pair again.' });
    await remoteClient(app, device.cookie).send('post', '/api/remote/session/end').expect(401);
    expect((await listedDevices()).get(device.id)).not.toBeNull();
  });

  it('records that the device ended it itself', async () => {
    const device = await pairDevice(app, 'Other Mac');
    await remoteClient(app, device.cookie).send('post', '/api/remote/session/end').expect(204);
    expect(await revokedAudit()).toEqual([
      { device_id: device.id, device_name: 'Other Mac', detail: { by: 'device' } },
    ]);
    const { rows } = await t.db.query<{ status: number | null }>(
      `SELECT status FROM remote_audit
       WHERE action = 'request' AND path = '/api/remote/session/end'`,
    );
    expect(rows).toHaveLength(1);
  });

  it('leaves another paired device untouched, whatever the body names', async () => {
    const device = await pairDevice(app, 'Other Mac');
    const other = await pairDevice(app, 'Phone');
    await remoteClient(app, device.cookie)
      .send('post', '/api/remote/session/end', { id: other.id, deviceId: other.id })
      .expect(204);

    const devices = await listedDevices();
    expect(devices.get(device.id)).not.toBeNull();
    expect(devices.get(other.id)).toBeNull();
    await remoteClient(app, other.cookie).get('/api/conversations').expect(200);
    expect((await revokedAudit()).map((row) => row.device_id)).toEqual([device.id]);
  });

  it('removes the device’s push subscriptions as Revoke does', async () => {
    const device = await pairDevice(app, 'Other Mac');
    await setSwitches(app, { notifications: true });
    await remoteClient(app, device.cookie)
      .send('put', '/api/remote/push/subscription', {
        endpoint: 'https://fcm.googleapis.com/fcm/send/device-one',
        keys: {
          p256dh:
            'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM',
          auth: 'tBHItJI5svbpez7KI4CCXg',
        },
      })
      .expect(200);
    await remoteClient(app, device.cookie).send('post', '/api/remote/session/end').expect(204);
    const { rows } = await t.db.query('SELECT 1 FROM remote_push_subscriptions');
    expect(rows).toEqual([]);
  });

  it('is not there for the Mac itself or an unpaired caller', async () => {
    const device = await pairDevice(app, 'Other Mac');
    await localClient(app).send('post', '/api/remote/session/end').expect(404);
    await localClient(app).send('post', '/api/remote/session/end', { id: device.id }).expect(404);
    await remoteClient(app).send('post', '/api/remote/session/end').expect(401);
    expect((await listedDevices()).get(device.id)).toBeNull();
    expect(await revokedAudit()).toEqual([]);
  });

  it('needs the Mac’s own https origin', async () => {
    const device = await pairDevice(app, 'Other Mac');
    const headers = { Host: REMOTE_HOST, Cookie: device.cookie };
    await request(app).post('/api/remote/session/end').set(headers).expect(403);
    await request(app)
      .post('/api/remote/session/end')
      .set(headers)
      .set('Origin', 'https://elsewhere.example')
      .expect(403);
    expect((await listedDevices()).get(device.id)).toBeNull();
  });
});
