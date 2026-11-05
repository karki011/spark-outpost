import http from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_TOKEN_HEADER, REMOTE_DEVICE_COOKIE } from '@spark-outpost/contracts';
import { attachTerminalSockets } from '../src/terminal/websocket.ts';
import { loginShellSpawner } from '../src/terminal/pty.ts';
import { TerminalSessions } from '../src/terminal/sessions.ts';
import {
  API_TOKEN,
  HOST,
  LOCAL_HEADERS,
  ORIGIN,
  PORT,
  createTestApp,
  localClient,
} from './app-support.ts';
import {
  ENTERED,
  REMOTE_HOST,
  REMOTE_ORIGIN,
  pairDevice,
  remoteClient,
  turnRemoteOn,
} from './remote-support.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

let t: TestDb;
let app: ReturnType<typeof createTestApp>;

beforeEach(async () => {
  t = await createTestDb();
  app = createTestApp(t);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await t.cleanup();
});

const auditRows = async () =>
  (
    await t.db.query<{
      action: string;
      device_id: string | null;
      device_name: string | null;
      method: string | null;
      path: string | null;
      status: number | null;
      detail: Record<string, unknown>;
    }>('SELECT * FROM remote_audit ORDER BY created_at, id')
  ).rows;

describe('local traffic', () => {
  it('is unchanged when phone access is on', async () => {
    await turnRemoteOn(app);
    await request(app).get('/api/health').set('Host', HOST).expect(401);
    await request(app).get('/api/health').set(LOCAL_HEADERS).expect(200);
    await request(app)
      .get('/api/health')
      .set(LOCAL_HEADERS)
      .set('Origin', REMOTE_ORIGIN)
      .expect(403);
    await request(app)
      .post('/api/conversations')
      .set(LOCAL_HEADERS)
      .set('Origin', ORIGIN)
      .type('form')
      .send('id=1')
      .expect(415);
  });

  it('gives a loopback caller nothing for a device cookie without the launch token', async () => {
    await turnRemoteOn(app);
    const device = await pairDevice(app);
    await request(app)
      .get('/api/conversations')
      .set({ Host: HOST, Cookie: device.cookie })
      .expect(401);
  });
});

describe('remote host', () => {
  it('is refused while the hostname setting is empty', async () => {
    const refused = await remoteClient(app).get('/api/health').expect(403);
    expect(refused.body).toEqual({ error: 'Requests must target the local API host.' });
    await remoteClient(app).get('/').expect(403);
    await request(app)
      .get('/api/health')
      .set({ Host: REMOTE_HOST, [API_TOKEN_HEADER]: API_TOKEN })
      .expect(403);
  });

  it('is accepted only as the exact configured hostname', async () => {
    await turnRemoteOn(app);
    await remoteClient(app).get('/').expect(200);
    for (const host of [
      `evil.${REMOTE_HOST}`,
      `${REMOTE_HOST}.evil.example`,
      `${REMOTE_HOST}:${PORT}`,
      'other.tail1234.ts.net',
    ]) {
      await request(app).get('/').set('Host', host).expect(403);
    }
    await turnRemoteOn(app, null);
    await remoteClient(app).get('/').expect(403);
  });

  it('needs the matching https origin, and an origin on every write', async () => {
    await turnRemoteOn(app);
    const device = await pairDevice(app);
    const headers = { Host: REMOTE_HOST, Cookie: device.cookie };
    await request(app).get('/api/conversations').set(headers).expect(200);
    await request(app)
      .get('/api/conversations')
      .set(headers)
      .set('Origin', REMOTE_ORIGIN)
      .expect(200);
    for (const origin of [`http://${REMOTE_HOST}`, 'https://evil.example', ORIGIN, 'null']) {
      await request(app).get('/api/conversations').set(headers).set('Origin', origin).expect(403);
    }
    await request(app)
      .post('/api/conversations')
      .set(headers)
      .send({ id: crypto.randomUUID() })
      .expect(403);
  });

  it('rejects a hostname that is not a plain DNS name', async () => {
    for (const hostname of ['localhost', '127.0.0.1', 'mac', 'Mac.ts.net', 'mac.ts.net:443', '']) {
      await localClient(app).send('put', '/api/remote/access', { hostname }).expect(400);
    }
  });

  it('gives the launch token no power on a remote request', async () => {
    await turnRemoteOn(app);
    const withToken = { Host: REMOTE_HOST, [API_TOKEN_HEADER]: API_TOKEN };
    await request(app).get('/api/conversations').set(withToken).expect(401);
    await request(app)
      .post('/api/remote/pairings')
      .set(withToken)
      .set('Origin', REMOTE_ORIGIN)
      .send({})
      .expect(401);

    const device = await pairDevice(app);
    await request(app)
      .post('/api/remote/pairings')
      .set({ ...withToken, Cookie: device.cookie })
      .set('Origin', REMOTE_ORIGIN)
      .send({})
      .expect(403);
    await request(app)
      .post('/api/terminal/sessions')
      .set({ ...withToken, Cookie: device.cookie })
      .set('Origin', REMOTE_ORIGIN)
      .send({})
      .expect(403);
  });

  it('shows an unpaired device only the pairing page', async () => {
    await turnRemoteOn(app);
    const page = await remoteClient(app).get(`/${ENTERED}`).expect(200);
    expect(page.headers['content-type']).toContain('text/html');
    expect(page.headers['content-security-policy']).toContain("default-src 'none'");
    expect(page.headers['cache-control']).toBe('no-store');
    expect(page.text).toContain('Pair this device');
    expect((await remoteClient(app).get(`/chats/anything${ENTERED}`).expect(200)).text).toContain(
      'Pair this device',
    );
    for (const path of [
      '/api/health',
      '/api/conversations',
      '/api/events',
      '/api/remote/switches',
    ]) {
      const refused = await remoteClient(app).get(path).expect(401);
      expect(refused.body).toEqual({ error: 'Pair this device first.' });
    }
    await remoteClient(app)
      .send('post', '/api/conversations', { id: crypto.randomUUID() })
      .expect(401);
    await request(app)
      .get('/api/conversations')
      .set({ Host: REMOTE_HOST, Cookie: `${REMOTE_DEVICE_COOKIE}=${'a'.repeat(43)}` })
      .expect(401);
  });
});

describe('device sessions', () => {
  beforeEach(() => turnRemoteOn(app));

  it('refuses a revoked device on its next request', async () => {
    const device = await pairDevice(app);
    await remoteClient(app, device.cookie).get('/api/conversations').expect(200);
    const revoked = await localClient(app)
      .send('delete', `/api/remote/devices/${device.id}`)
      .expect(200);
    expect(revoked.body.devices[0].revokedAt).not.toBeNull();
    const refused = await remoteClient(app, device.cookie).get('/api/conversations').expect(401);
    expect(refused.body).toEqual({ error: 'This device needs to pair again.' });
    expect((await remoteClient(app, device.cookie).get('/').expect(200)).text).toContain(
      'Pair this device',
    );
    const rows = await auditRows();
    expect(rows.at(-1)).toMatchObject({
      action: 'pairing_page_shown',
      device_id: device.id,
      detail: { reason: 'revoked' },
    });
    expect(rows.at(-2)).toMatchObject({
      action: 'refused',
      device_id: device.id,
      status: 401,
      detail: { reason: 'revoked' },
    });
  });

  it('refuses a device unused for thirty days', async () => {
    const device = await pairDevice(app);
    await t.db.query(
      `UPDATE remote_devices SET last_seen_at = now() - interval '29 days 23 hours'`,
    );
    await remoteClient(app, device.cookie).get('/api/conversations').expect(200);
    await t.db.query(`UPDATE remote_devices SET last_seen_at = now() - interval '30 days 1 hour'`);
    await remoteClient(app, device.cookie).get('/api/conversations').expect(401);
    const listed = await localClient(app).get('/api/remote/devices').expect(200);
    expect(listed.body.devices[0]).toMatchObject({ expired: true, revokedAt: null });
  });

  it('records when a device was last seen', async () => {
    const device = await pairDevice(app);
    await t.db.query(`UPDATE remote_devices SET last_seen_at = now() - interval '2 days'`);
    await remoteClient(app, device.cookie).get('/api/conversations').expect(200);
    const { rows } = await t.db.query<{ recent: boolean }>(
      `SELECT last_seen_at > now() - interval '1 minute' AS recent FROM remote_devices`,
    );
    expect(rows[0]!.recent).toBe(true);
  });

  it('renames a device and disconnects all of them', async () => {
    const first = await pairDevice(app, 'First');
    const second = await pairDevice(app, 'Second');
    const renamed = await localClient(app)
      .send('patch', `/api/remote/devices/${first.id}`, { name: '  Work phone ' })
      .expect(200);
    expect(renamed.body.name).toBe('Work phone');
    await localClient(app)
      .send('patch', `/api/remote/devices/${crypto.randomUUID()}`, { name: 'x' })
      .expect(404);

    await localClient(app).send('post', '/api/remote/devices/disconnect-all').expect(200);
    await remoteClient(app, first.cookie).get('/api/conversations').expect(401);
    await remoteClient(app, second.cookie).get('/api/conversations').expect(401);
  });

  it('closes a revoked device’s open event stream', async () => {
    const device = await pairDevice(app);
    const other = await pairDevice(app, 'Other phone');
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const { port } = server.address() as AddressInfo;
    const open = (cookie: string) =>
      new Promise<{ closed: Promise<void>; stream: http.ClientRequest }>((resolve, reject) => {
        const stream = http.get(
          {
            host: '127.0.0.1',
            port,
            path: '/api/events',
            headers: { Host: REMOTE_HOST, Cookie: cookie, Accept: 'text/event-stream' },
          },
          (res) => {
            expect(res.statusCode).toBe(200);
            res.resume();
            resolve({
              stream,
              closed: new Promise<void>((done) => res.once('close', () => done())),
            });
          },
        );
        stream.on('error', reject);
      });
    try {
      const revokedStream = await open(device.cookie);
      const keptStream = await open(other.cookie);
      let keptClosed = false;
      void keptStream.closed.then(() => {
        keptClosed = true;
      });
      const listed = await localClient(app).get('/api/remote/devices').expect(200);
      expect(listed.body.devices.map((row: { connected: boolean }) => row.connected)).toEqual([
        true,
        true,
      ]);

      await localClient(app).send('delete', `/api/remote/devices/${device.id}`).expect(200);
      await revokedStream.closed;
      expect(keptClosed).toBe(false);
      await eventually(async () => {
        const after = await localClient(app).get('/api/remote/devices');
        return after.body.devices[0].connected === false && after.body.devices[1].connected;
      });
      keptStream.stream.destroy();
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('closes every stream when phone access is turned off', async () => {
    const device = await pairDevice(app);
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
              headers: { Host: REMOTE_HOST, Cookie: device.cookie, Accept: 'text/event-stream' },
            },
            (res) => {
              res.resume();
              res.once('close', () => resolve());
              void turnRemoteOn(app, null);
            },
          )
          .on('error', reject);
      });
      await closed;
      await remoteClient(app, device.cookie).get('/api/conversations').expect(403);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

describe('terminal socket', () => {
  it('refuses a remote upgrade, paired or not, with or without the launch token', async () => {
    await turnRemoteOn(app);
    const device = await pairDevice(app);
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const { port } = server.address() as AddressInfo;
    const sockets = attachTerminalSockets(
      server,
      new TerminalSessions(loginShellSpawner('/bin/sh')),
      {
        port: PORT,
        allowedOrigins: [ORIGIN],
        apiToken: API_TOKEN,
      },
    );
    const upgrade = (headers: http.OutgoingHttpHeaders) =>
      new Promise<number>((resolve, reject) => {
        const attempt = http.request({
          host: '127.0.0.1',
          port,
          path: `/api/terminal/sessions/${crypto.randomUUID()}/stream`,
          headers: {
            Connection: 'Upgrade',
            Upgrade: 'websocket',
            'Sec-WebSocket-Version': '13',
            'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
            ...headers,
          },
        });
        attempt.on('response', (res) => resolve(res.statusCode ?? 0));
        attempt.on('upgrade', (res, socket) => {
          socket.destroy();
          resolve(res.statusCode ?? 0);
        });
        attempt.on('error', reject);
        attempt.end();
      });
    try {
      const remote = { Host: REMOTE_HOST, Origin: REMOTE_ORIGIN };
      expect(await upgrade(remote)).toBe(403);
      expect(await upgrade({ ...remote, Cookie: device.cookie })).toBe(403);
      expect(
        await upgrade({ ...remote, Cookie: device.cookie, [API_TOKEN_HEADER]: API_TOKEN }),
      ).toBe(403);
      expect(await upgrade({ ...remote, Origin: ORIGIN, [API_TOKEN_HEADER]: API_TOKEN })).toBe(403);
      expect(await upgrade({ Host: HOST, Origin: ORIGIN, Cookie: device.cookie })).toBe(401);
    } finally {
      sockets.close();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
