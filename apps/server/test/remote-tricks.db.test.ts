import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp } from './app-support.ts';
import {
  REMOTE_HOST,
  REMOTE_ORIGIN,
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

describe('path tricks from a paired phone', () => {
  it('never reach a route the policy refuses', async () => {
    const device = await pairDevice(app);
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const { port } = server.address() as AddressInfo;
    const statusOf = (method: string, path: string) =>
      new Promise<number>((resolve, reject) => {
        const attempt = http.request(
          {
            host: '127.0.0.1',
            port,
            method,
            path,
            headers: {
              Host: REMOTE_HOST,
              Origin: REMOTE_ORIGIN,
              Cookie: device.cookie,
              'Content-Type': 'application/json',
              'Content-Length': 2,
            },
          },
          (res) => {
            res.resume();
            resolve(res.statusCode ?? 0);
          },
        );
        attempt.on('error', reject);
        attempt.end('{}');
      });
    const tricks = [
      '//api/terminal/sessions',
      '/api//terminal/sessions',
      '/API/terminal/sessions',
      '/api/terminal/sessions/',
      '/api/terminal/sessions?x=1',
      '/api/terminal%2Fsessions',
      '/%61pi/terminal/sessions',
      '/x/../api/terminal/sessions',
      '/./api/terminal/sessions',
      '/api/./terminal/sessions',
      '\\api\\terminal\\sessions',
      `http://127.0.0.1:${port}/api/terminal/sessions`,
      '/api/remote/pairings',
      '/api/remote//pairings',
      '/api/remote/pairings/',
    ];
    try {
      for (const path of tricks) {
        expect([path, [400, 403, 404].includes(await statusOf('POST', path))]).toEqual([
          path,
          true,
        ]);
      }
      const started = await t.db.query(
        `SELECT 1 FROM remote_audit WHERE action = 'pairing_started'`,
      );
      expect(started.rowCount).toBe(1);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

describe('the web app over the remote host', () => {
  it('gives an unpaired device the theme and the pairing page, a paired one the app', async () => {
    const webRoot = await mkdtemp(join(tmpdir(), 'spark-remote-web-'));
    await writeFile(join(webRoot, 'theme.css'), ':root { --bg: #fff; }');
    await writeFile(join(webRoot, 'index.html'), '<title>Spark Outpost app</title>');
    await writeFile(join(webRoot, 'app.js'), 'window.app = true;');
    await writeFile(join(webRoot, 'manifest.webmanifest'), '{"name":"Spark Outpost"}');
    await writeFile(join(webRoot, 'icon-192.png'), 'png');
    try {
      app = createTestApp(t, { webRoot });
      const stranger = remoteClient(app);
      expect((await stranger.get('/theme.css').expect(200)).text).toContain('--bg');
      const manifest = await stranger.get('/manifest.webmanifest').expect(200);
      expect(manifest.headers['content-type']).toContain('application/manifest+json');
      expect(manifest.body).toEqual({ name: 'Spark Outpost' });
      await stranger.get('/icon-192.png').expect(200).expect('content-type', /image\/png/);
      expect((await stranger.get('/app.js').expect(200)).text).toContain('Pair this device');
      expect((await stranger.get('/secrets.png').expect(200)).text).toContain('Pair this device');
      expect((await stranger.get('/').expect(200)).text).toContain('Pair this device');

      const device = await pairDevice(app);
      const phone = remoteClient(app, device.cookie);
      expect((await phone.get('/').expect(200)).text).toContain('Spark Outpost app');
      expect((await phone.get('/app.js').expect(200)).text).toContain('window.app');
    } finally {
      await rm(webRoot, { recursive: true, force: true });
    }
  });
});
