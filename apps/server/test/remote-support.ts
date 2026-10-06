import request from 'supertest';
import { REMOTE_DEVICE_COOKIE, type RemoteSwitches } from '@spark-outpost/contracts';
import { localClient, type createTestApp } from './app-support.ts';

type TestApp = ReturnType<typeof createTestApp>;

export const REMOTE_HOST = 'mac.tail1234.ts.net';
export const REMOTE_ORIGIN = `https://${REMOTE_HOST}`;

export async function turnRemoteOn(app: TestApp, hostname: string | null = REMOTE_HOST) {
  await localClient(app).send('put', '/api/remote/access', { hostname }).expect(200);
}

export async function setSwitches(app: TestApp, change: Partial<RemoteSwitches>) {
  await localClient(app).send('patch', '/api/remote/switches', change).expect(200);
}

export function remoteClient(
  app: TestApp,
  cookie: string | null = null,
  host: string = REMOTE_HOST,
) {
  const headers = { Host: host, ...(cookie ? { Cookie: cookie } : {}) };
  return {
    get: (path: string) => request(app).get(path).set(headers),
    send: (method: 'post' | 'put' | 'patch' | 'delete', path: string, body: object = {}) =>
      request(app)[method](path).set(headers).set('Origin', `https://${host}`).send(body),
  };
}

export function sessionCookieOf(setCookie: string): string {
  return setCookie.split(';')[0]!;
}

export function deviceTokenIn(cookie: string): string {
  return cookie.slice(REMOTE_DEVICE_COOKIE.length + 1);
}

export interface PairedDevice {
  id: string;
  cookie: string;
  setCookie: string;
}

export async function submitPairing(app: TestApp, deviceName: string, host: string = REMOTE_HOST) {
  const started = await localClient(app).send('post', '/api/remote/pairings').expect(201);
  const submitted = await remoteClient(app, null, host)
    .send('post', '/api/remote/pair', { code: started.body.code, deviceName })
    .expect(200);
  return {
    pairingId: started.body.id as string,
    code: started.body.code as string,
    claim: submitted.body.claim as string,
    matchCode: submitted.body.matchCode as string,
  };
}

export async function pairDevice(
  app: TestApp,
  deviceName = 'Test phone',
  host: string = REMOTE_HOST,
): Promise<PairedDevice> {
  const pairing = await submitPairing(app, deviceName, host);
  await localClient(app)
    .send('post', `/api/remote/pairings/${pairing.pairingId}/confirm`)
    .expect(200);
  const claimed = await remoteClient(app, null, host)
    .send('post', '/api/remote/pair/claim', { claim: pairing.claim })
    .expect(200);
  const setCookie = (claimed.headers['set-cookie'] as unknown as string[])[0]!;
  const devices = await localClient(app).get('/api/remote/devices').expect(200);
  const device = (devices.body.devices as { id: string; name: string }[]).find(
    (candidate) => candidate.name === deviceName,
  )!;
  return { id: device.id, cookie: sessionCookieOf(setCookie), setCookie };
}
