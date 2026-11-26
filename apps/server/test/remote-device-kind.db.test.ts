import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RemoteDevice } from '@spark-outpost/contracts';
import { createTestApp, localClient } from './app-support.ts';
import {
  REMOTE_HOST,
  remoteClient,
  sessionCookieOf,
  turnRemoteOn,
  type PairedDevice,
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

const devices = async () =>
  (await localClient(app).get('/api/remote/devices').expect(200)).body.devices as RemoteDevice[];

const pending = async () =>
  (await localClient(app).get('/api/remote/pairings').expect(200)).body.pairings as {
    id: string;
    deviceName: string;
    kind: string;
  }[];

async function submit(deviceName: string, kind: unknown, carried: string | null = null) {
  const started = await localClient(app).send('post', '/api/remote/pairings').expect(201);
  const body = { code: started.body.code, deviceName, ...(kind === undefined ? {} : { kind }) };
  const submitted = await remoteClient(app, carried).send('post', '/api/remote/pair', body);
  return { pairingId: started.body.id as string, submitted };
}

async function pair(
  deviceName: string,
  kind: unknown,
  carried: string | null = null,
): Promise<PairedDevice> {
  const { pairingId, submitted } = await submit(deviceName, kind, carried);
  expect(submitted.status).toBe(200);
  await localClient(app).send('post', `/api/remote/pairings/${pairingId}/confirm`).expect(200);
  const claimed = await remoteClient(app, carried)
    .send('post', '/api/remote/pair/claim', { claim: submitted.body.claim })
    .expect(200);
  const setCookie = (claimed.headers['set-cookie'] as unknown as string[])[0]!;
  const cookie = sessionCookieOf(setCookie);
  const session = await remoteClient(app, cookie).get('/api/remote/session').expect(200);
  return { id: session.body.device.id as string, cookie, setCookie };
}

describe('device kind', () => {
  it('shows a Spark as a Spark while it waits and after it is confirmed', async () => {
    const { pairingId } = await submit('Studio Mac', 'spark');
    expect(await pending()).toEqual([
      expect.objectContaining({ id: pairingId, deviceName: 'Studio Mac', kind: 'spark' }),
    ]);
    await localClient(app).send('post', `/api/remote/pairings/${pairingId}/deny`).expect(200);

    const device = await pair('Studio Mac', 'spark');

    expect(await devices()).toEqual([expect.objectContaining({ id: device.id, kind: 'spark' })]);
    const { rows } = await t.db.query<{ kind: string }>('SELECT kind FROM remote_devices');
    expect(rows).toEqual([{ kind: 'spark' }]);
  });

  it('calls a device a browser when the pairing page sent no kind', async () => {
    const { pairingId } = await submit('Kitchen phone', undefined);
    expect(await pending()).toEqual([expect.objectContaining({ id: pairingId, kind: 'browser' })]);
    await localClient(app).send('post', `/api/remote/pairings/${pairingId}/deny`).expect(200);

    await pair('Kitchen phone', 'browser');

    expect((await devices()).map((device) => device.kind)).toEqual(['browser']);
  });

  it('refuses a kind it does not know', async () => {
    const { submitted } = await submit('Kitchen phone', 'admin');

    expect(submitted.status).toBe(400);
    expect(await pending()).toEqual([]);
  });

  it('keeps the row and updates the kind when a device pairs again', async () => {
    const first = await pair('Studio Mac', undefined);
    const again = await pair('Studio Mac', 'spark', first.cookie);

    expect(again.id).toBe(first.id);
    expect(await devices()).toEqual([expect.objectContaining({ id: first.id, kind: 'spark' })]);

    await pair('Studio Mac', undefined, again.cookie);
    expect(await devices()).toEqual([expect.objectContaining({ id: first.id, kind: 'browser' })]);
  });

  it('gives a Spark exactly what a browser gets', async () => {
    const spark = await pair('Studio Mac', 'spark');
    const browser = await pair('Kitchen phone', 'browser');
    const routes: ['get' | 'post', string][] = [
      ['get', '/api/conversations'],
      ['get', '/api/remote/session'],
      ['get', '/api/remote/devices'],
      ['get', '/api/remote-sparks'],
      ['post', '/api/remote/pairings'],
      ['get', '/api/settings'],
    ];
    for (const [method, path] of routes) {
      const asSpark = remoteClient(app, spark.cookie, REMOTE_HOST);
      const asBrowser = remoteClient(app, browser.cookie, REMOTE_HOST);
      const [one, other] =
        method === 'get'
          ? [await asSpark.get(path), await asBrowser.get(path)]
          : [await asSpark.send(method, path), await asBrowser.send(method, path)];
      expect([path, one.status]).toEqual([path, other.status]);
    }
  });
});
