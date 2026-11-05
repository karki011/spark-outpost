import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { REMOTE_DEVICE_COOKIE } from '@spark-outpost/contracts';
import { secretHash } from '../src/remote/session.ts';
import { createTestApp, localClient } from './app-support.ts';
import {
  deviceTokenIn,
  pairDevice,
  remoteClient,
  submitPairing,
  turnRemoteOn,
} from './remote-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let app: ReturnType<typeof createTestApp>;

beforeEach(async () => {
  t = await createTestDb();
  app = createTestApp(t);
});

afterEach(async () => {
  await t.cleanup();
});

const auditRows = async () =>
  (
    await t.db.query<{ action: string; device_id: string | null; device_name: string | null }>(
      'SELECT * FROM remote_audit ORDER BY created_at, id',
    )
  ).rows;

describe('pairing over HTTP', () => {
  beforeEach(() => turnRemoteOn(app));

  it('pairs a device and sets a locked-down cookie', async () => {
    const device = await pairDevice(app, 'Kitchen phone');
    const flags = device.setCookie.split('; ').slice(1);
    expect(device.setCookie.startsWith(`${REMOTE_DEVICE_COOKIE}=`)).toBe(true);
    expect(flags).toEqual(
      expect.arrayContaining(['Path=/', 'HttpOnly', 'Secure', 'SameSite=Strict']),
    );
    expect(flags.some((flag) => flag.startsWith('Domain'))).toBe(false);
    await remoteClient(app, device.cookie).get('/api/conversations').expect(200);
  });

  it('stores the session token only as a hash', async () => {
    const device = await pairDevice(app);
    const token = deviceTokenIn(device.cookie);
    const { rows } = await t.db.query<{ token_hash: string }>(
      'SELECT token_hash FROM remote_devices',
    );
    expect(rows).toEqual([{ token_hash: secretHash(token) }]);
    const everything = await t.db.query<{ dump: string }>(
      `SELECT (SELECT coalesce(json_agg(d), '[]')::text FROM remote_devices d) ||
              (SELECT coalesce(json_agg(a), '[]')::text FROM remote_audit a) AS dump`,
    );
    expect(everything.rows[0]!.dump).not.toContain(token);
  });

  it('cannot be started from a remote device', async () => {
    await remoteClient(app).send('post', '/api/remote/pairings').expect(401);
    const device = await pairDevice(app);
    await remoteClient(app, device.cookie).send('post', '/api/remote/pairings').expect(403);
    await remoteClient(app, device.cookie).get('/api/remote/pairings').expect(403);
  });

  it('is only offered to remote requests', async () => {
    await localClient(app)
      .send('post', '/api/remote/pair', { code: 'AAAA-AAAA-AAAA', deviceName: 'Mac' })
      .expect(404);
    await localClient(app).send('post', '/api/remote/pair/claim', { claim: 'x' }).expect(404);
  });

  it('refuses a wrong code and a reused code the same way', async () => {
    const wrong = await remoteClient(app)
      .send('post', '/api/remote/pair', { code: 'AAAA-AAAA-AAAA', deviceName: 'Phone' })
      .expect(403);
    const pairing = await submitPairing(app, 'Phone');
    const reused = await remoteClient(app)
      .send('post', '/api/remote/pair', { code: pairing.code, deviceName: 'Second' })
      .expect(403);
    expect(reused.body).toEqual(wrong.body);
    await remoteClient(app)
      .send('post', '/api/remote/pair', { code: pairing.code, deviceName: '' })
      .expect(400);
  });

  it('gives no session until the Mac confirms', async () => {
    const pairing = await submitPairing(app, 'Phone');
    const waiting = await remoteClient(app)
      .send('post', '/api/remote/pair/claim', { claim: pairing.claim })
      .expect(202);
    expect(waiting.body).toEqual({ status: 'waiting' });
    expect(waiting.headers['set-cookie']).toBeUndefined();
    await remoteClient(app).send('post', '/api/remote/pair/claim', { claim: 'guess' }).expect(403);

    const pending = await localClient(app).get('/api/remote/pairings').expect(200);
    expect(pending.body.pairings).toEqual([
      expect.objectContaining({
        id: pairing.pairingId,
        deviceName: 'Phone',
        matchCode: pairing.matchCode,
      }),
    ]);
    expect((await t.db.query('SELECT 1 FROM remote_devices')).rowCount).toBe(0);
  });

  it('ends a denied pairing', async () => {
    const pairing = await submitPairing(app, 'Phone');
    await localClient(app)
      .send('post', `/api/remote/pairings/${pairing.pairingId}/deny`)
      .expect(200);
    await remoteClient(app)
      .send('post', '/api/remote/pair/claim', { claim: pairing.claim })
      .expect(403);
    await localClient(app)
      .send('post', `/api/remote/pairings/${pairing.pairingId}/confirm`)
      .expect(409);
    expect((await t.db.query('SELECT 1 FROM remote_devices')).rowCount).toBe(0);
  });

  it('hands the session out once', async () => {
    const pairing = await submitPairing(app, 'Phone');
    await localClient(app)
      .send('post', `/api/remote/pairings/${pairing.pairingId}/confirm`)
      .expect(200);
    const claim = () =>
      remoteClient(app).send('post', '/api/remote/pair/claim', { claim: pairing.claim });
    await claim().expect(200);
    await claim().expect(403);
    expect((await t.db.query('SELECT 1 FROM remote_devices')).rowCount).toBe(1);
  });

  it('limits code guesses', async () => {
    const guess = () =>
      remoteClient(app).send('post', '/api/remote/pair', {
        code: 'AAAA-AAAA-AAAA',
        deviceName: 'Phone',
      });
    for (let attempt = 0; attempt < 5; attempt += 1) await guess().expect(403);
    await guess().expect(429);
  });

  it('limits how often pairing starts', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await localClient(app).send('post', '/api/remote/pairings').expect(201);
    }
    await localClient(app).send('post', '/api/remote/pairings').expect(429);
  });

  it('audits each step without the code, the claim or the token', async () => {
    const pairing = await submitPairing(app, 'Phone');
    await remoteClient(app)
      .send('post', '/api/remote/pair', { code: 'AAAA-AAAA-AAAA', deviceName: 'Phone' })
      .expect(403);
    await localClient(app)
      .send('post', `/api/remote/pairings/${pairing.pairingId}/confirm`)
      .expect(200);
    const claimed = await remoteClient(app)
      .send('post', '/api/remote/pair/claim', { claim: pairing.claim })
      .expect(200);
    const token = deviceTokenIn(
      (claimed.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!,
    );

    const rows = await auditRows();
    expect(rows.map((row) => row.action)).toEqual([
      'hostname_changed',
      'pairing_started',
      'pairing_submitted',
      'pairing_failed',
      'pairing_confirmed',
      'device_paired',
    ]);
    expect(rows.at(-1)).toMatchObject({ device_name: 'Phone' });
    expect(rows.at(-1)!.device_id).toMatch(/^[0-9a-f-]{36}$/);
    const text = JSON.stringify(rows);
    for (const secret of [pairing.code, pairing.code.replaceAll('-', ''), pairing.claim, token]) {
      expect(text).not.toContain(secret);
    }
  });
});
