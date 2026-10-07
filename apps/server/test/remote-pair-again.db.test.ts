import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { REMOTE_DEVICE_COOKIE, type RemoteDevice } from '@spark-outpost/contracts';
import { secretHash } from '../src/remote/session.ts';
import { createTestApp, localClient } from './app-support.ts';
import {
  ENTERED,
  REMOTE_HOST,
  deviceTokenIn,
  pairDevice,
  remoteClient,
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

const devices = async (): Promise<RemoteDevice[]> =>
  (await localClient(app).get('/api/remote/devices').expect(200)).body.devices;

const auditOf = async (action: string) =>
  (
    await t.db.query<{ device_id: string | null; detail: Record<string, unknown> }>(
      'SELECT device_id, detail FROM remote_audit WHERE action = $1 ORDER BY created_at, id',
      [action],
    )
  ).rows;

const navigation = (path: string, site: string, cookie: string | null = null) =>
  remoteClient(app, cookie)
    .get(path)
    .set({ 'Sec-Fetch-Site': site, 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document' });

describe('pairing the same phone again', () => {
  it('keeps one device when the phone still has a valid sign-in', async () => {
    const first = await pairDevice(app, 'Kitchen phone');
    await t.db.query(`UPDATE remote_devices SET last_seen_at = now() - interval '3 days'`);
    const again = await pairDevice(app, 'Hall phone', REMOTE_HOST, first.cookie);

    expect(again.id).toBe(first.id);
    expect(again.cookie).not.toBe(first.cookie);
    const listed = await devices();
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id: first.id, name: 'Hall phone', revokedAt: null });
    expect(Date.now() - new Date(listed[0]!.lastSeenAt).getTime()).toBeLessThan(60_000);
    await remoteClient(app, first.cookie).get('/api/conversations').expect(401);
    await remoteClient(app, again.cookie).get('/api/conversations').expect(200);
    expect(await auditOf('device_paired_again')).toMatchObject([{ device_id: first.id }]);
    expect(await auditOf('device_paired')).toHaveLength(1);
    const { rows } = await t.db.query<{ token_hash: string }>(
      'SELECT token_hash FROM remote_devices',
    );
    expect(rows).toEqual([{ token_hash: secretHash(deviceTokenIn(again.cookie)) }]);
  });

  it('adds a new device and hides the old one when the sign-in was revoked', async () => {
    const first = await pairDevice(app, 'Kitchen phone');
    await localClient(app).send('delete', `/api/remote/devices/${first.id}`).expect(200);
    const again = await pairDevice(app, 'Kitchen phone', REMOTE_HOST, first.cookie);

    expect(again.id).not.toBe(first.id);
    const listed = await devices();
    expect(listed).toHaveLength(2);
    expect(listed.find((device) => device.id === first.id)).toMatchObject({
      replacedBy: again.id,
      duplicateOf: null,
    });
    expect(listed.find((device) => device.id === first.id)!.revokedAt).not.toBeNull();
    expect(listed.find((device) => device.id === again.id)).toMatchObject({
      revokedAt: null,
      replacedBy: null,
    });
    await remoteClient(app, first.cookie).get('/api/conversations').expect(401);
    expect((await auditOf('device_paired')).at(-1)).toMatchObject({
      device_id: again.id,
      detail: { replaced: first.id },
    });
    expect(await auditOf('device_paired_again')).toEqual([]);
  });

  it('adds a new device and retires the old one when the sign-in ran out', async () => {
    const first = await pairDevice(app, 'Kitchen phone');
    await t.db.query(`UPDATE remote_devices SET last_seen_at = now() - interval '31 days'`);
    const again = await pairDevice(app, 'Kitchen phone', REMOTE_HOST, first.cookie);

    expect(again.id).not.toBe(first.id);
    const old = (await devices()).find((device) => device.id === first.id)!;
    expect(old.replacedBy).toBe(again.id);
    expect(old.revokedAt).not.toBeNull();
    await remoteClient(app, first.cookie).get('/api/conversations').expect(401);
  });

  it('lists both when a phone with no sign-in reuses a name, and flags the older', async () => {
    const first = await pairDevice(app, 'Kitchen phone');
    const second = await pairDevice(app, '  kitchen PHONE ');
    const other = await pairDevice(app, 'Hall phone');

    const listed = await devices();
    expect(listed.map((device) => device.id)).toEqual([first.id, second.id, other.id]);
    expect(listed.map((device) => device.duplicateOf)).toEqual([second.id, null, null]);
    expect(listed.every((device) => device.revokedAt === null)).toBe(true);
    await remoteClient(app, first.cookie).get('/api/conversations').expect(200);

    await localClient(app).send('delete', `/api/remote/devices/${second.id}`).expect(200);
    expect((await devices()).map((device) => device.duplicateOf)).toEqual([null, null, null]);
  });

  it('ignores a sign-in this Mac does not know', async () => {
    const stray = `${REMOTE_DEVICE_COOKIE}=${'a'.repeat(43)}`;
    await pairDevice(app, 'Kitchen phone', REMOTE_HOST, stray);
    expect(await devices()).toHaveLength(1);
  });

  it('gives the sign-in a lifetime longer than the thirty-day rule', async () => {
    const device = await pairDevice(app);
    const maxAge = /Max-Age=(\d+)/.exec(device.setCookie);
    expect(Number(maxAge?.[1])).toBeGreaterThan(30 * 24 * 60 * 60);
    expect(device.setCookie).toContain('SameSite=Strict');
  });
});

describe('arriving from another site or app', () => {
  it('sends a navigation without a sign-in round once, then shows the pairing page', async () => {
    for (const site of ['cross-site', 'same-site', 'none']) {
      const bounce = await navigation('/chats/one?tab=2', site).expect(200);
      expect(bounce.headers['cache-control']).toBe('no-store');
      expect(bounce.headers['content-security-policy']).toContain("default-src 'none'");
      expect(bounce.headers['x-frame-options']).toBe('DENY');
      expect(bounce.text).toContain('location.replace');
      expect(bounce.text).not.toContain('Pair this device');
    }
    const plain = await remoteClient(app).get('/').expect(200);
    expect(plain.text).toContain('location.replace');

    const landed = await navigation(`/chats/one${ENTERED}&tab=2`, 'same-origin').expect(200);
    expect(landed.text).toContain('Pair this device');
    expect(landed.headers['cache-control']).toBe('no-store');
    const again = await navigation(`/${ENTERED}`, 'cross-site').expect(200);
    expect(again.text).toContain('Pair this device');
    expect((await navigation('/', 'same-origin').expect(200)).text).toContain('Pair this device');
  });

  it('never bounces an API call, a write or a sub-resource', async () => {
    await navigation('/api/conversations', 'cross-site').expect(401);
    await remoteClient(app).send('post', '/chats', {}).expect(401);
    const image = await remoteClient(app)
      .get('/photo.png')
      .set({ 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Dest': 'image' })
      .expect(200);
    expect(image.text).toContain('Pair this device');
    const untagged = await remoteClient(app).get('/').set('Sec-Fetch-Site', 'cross-site');
    expect(untagged.text).toContain('location.replace');
  });

  it('takes a paired phone that comes back from the bounce to the clean address', async () => {
    const webRoot = await mkdtemp(join(tmpdir(), 'spark-remote-entry-'));
    await writeFile(join(webRoot, 'index.html'), '<title>Spark Outpost app</title>');
    await writeFile(join(webRoot, 'app.js'), 'window.app = true;');
    try {
      app = createTestApp(t, { webRoot });
      const device = await pairDevice(app);
      const back = await navigation(`/chats/one${ENTERED}&tab=2`, 'same-origin', device.cookie);
      expect(back.status).toBe(302);
      expect(back.headers.location).toBe('/chats/one?tab=2');
      expect(back.headers['cache-control']).toBe('no-store');
      for (const tricky of [`//evil.example/${ENTERED}`, `/%5Cevil.example${ENTERED}`]) {
        const redirected = await navigation(tricky, 'same-origin', device.cookie);
        expect(redirected.headers.location ?? '/').toMatch(/^\/(?![/\\])/);
      }

      const shell = await navigation('/chats/one', 'cross-site', device.cookie).expect(200);
      expect(shell.text).toContain('Spark Outpost app');
      expect(shell.headers['cache-control']).toBe('no-store');
      const asset = await remoteClient(app, device.cookie).get('/app.js').expect(200);
      expect(asset.headers['cache-control']).not.toBe('no-store');
    } finally {
      await rm(webRoot, { recursive: true, force: true });
    }
  });

  it('records why the pairing page was shown, at most once a minute per reason', async () => {
    const device = await pairDevice(app, 'Kitchen phone');
    const stray = `${REMOTE_DEVICE_COOKIE}=${'b'.repeat(43)}`;
    await navigation(`/${ENTERED}`, 'same-origin').expect(200);
    await navigation(`/${ENTERED}`, 'same-origin').expect(200);
    await navigation('/', 'same-origin', stray).expect(200);
    await navigation('/', 'cross-site').expect(200);
    await localClient(app).send('delete', `/api/remote/devices/${device.id}`).expect(200);
    await navigation('/', 'none', device.cookie).expect(200);

    const rows = await auditOf('pairing_page_shown');
    expect(rows).toEqual([
      { device_id: null, detail: { reason: 'missing' } },
      { device_id: null, detail: { reason: 'unknown' } },
      { device_id: device.id, detail: { reason: 'revoked' } },
    ]);
    const dump = await t.db.query<{ dump: string }>(
      `SELECT coalesce(json_agg(a), '[]')::text AS dump FROM remote_audit a`,
    );
    expect(dump.rows[0]!.dump).not.toContain(deviceTokenIn(device.cookie));
    expect(dump.rows[0]!.dump).not.toContain('b'.repeat(43));
  });
});
