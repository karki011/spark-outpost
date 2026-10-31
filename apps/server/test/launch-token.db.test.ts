import { randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_TOKEN_HEADER } from '@spark-outpost/contracts';
import { API_TOKEN, HOST, LOCAL_HEADERS, ORIGIN, createTestApp } from './app-support.ts';
import { createTestDb, type TestDb } from './support.ts';

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

const withToken = (token: string) => ({ Host: HOST, [API_TOKEN_HEADER]: token });

describe('launch token', () => {
  it('rejects requests without the token or with a wrong one', async () => {
    const missing = await request(app).get('/api/health').set('Host', HOST).expect(401);
    expect(missing.body).toEqual({ error: 'This request needs the API launch token.' });
    await request(app)
      .get('/api/conversations')
      .set(withToken(`${API_TOKEN}x`))
      .expect(401);
    await request(app)
      .get('/api/conversations')
      .set(withToken(API_TOKEN.slice(1)))
      .expect(401);
    await request(app)
      .post('/api/conversations')
      .set(withToken('wrong'))
      .set('Origin', ORIGIN)
      .send({ title: 'Nope' })
      .expect(401);
  });

  it('accepts requests with the token', async () => {
    await request(app).get('/api/health').set(LOCAL_HEADERS).expect(200);
    await request(app).get('/api/conversations').set(LOCAL_HEADERS).expect(200);
  });

  it('keeps the host and origin checks ahead of the token', async () => {
    await request(app)
      .get('/api/health')
      .set({ ...LOCAL_HEADERS, Host: 'evil.example:4318' })
      .expect(403);
    await request(app)
      .get('/api/health')
      .set(LOCAL_HEADERS)
      .set('Origin', 'https://evil.example')
      .expect(403);
  });

  it('guards the built page and its files like the API', async () => {
    const webRoot = mkdtempSync(path.join(tmpdir(), 'spark-launch-web-'));
    writeFileSync(path.join(webRoot, 'index.html'), '<title>Spark Outpost app</title>');
    writeFileSync(path.join(webRoot, 'app.js'), 'window.app = true;');
    const web = createTestApp(t, { webRoot });
    for (const file of ['/app.js', '/', '/settings']) {
      await request(web).get(file).set('Host', HOST).expect(401);
      await request(web).get(file).set(withToken('wrong')).expect(401);
      await request(web)
        .get(file)
        .set({ ...LOCAL_HEADERS, Host: 'evil.example:4318' })
        .expect(403);
      const served = await request(web).get(file).set(LOCAL_HEADERS).expect(200);
      expect(served.headers['content-security-policy']).toContain("script-src 'self'");
    }
    expect((await request(web).get('/app.js').set(LOCAL_HEADERS)).text).toBe('window.app = true;');
  });

  it('requires the token for uploads and the run stream', async () => {
    await request(app)
      .post('/api/attachments')
      .set('Host', HOST)
      .set('Origin', ORIGIN)
      .set('X-File-Name', 'notes.txt')
      .set('Content-Type', 'text/plain')
      .send('hello')
      .expect(401);
    await request(app).get(`/api/run-events?runs=${randomUUID()}:0`).set('Host', HOST).expect(401);
  });

  it('opens the app event stream only with the token', async () => {
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const { port } = server.address() as AddressInfo;
    const statusFor = (headers: http.OutgoingHttpHeaders) =>
      new Promise<number>((resolve, reject) => {
        const stream = http.get(
          { host: '127.0.0.1', port, path: '/api/events', headers },
          (res) => {
            resolve(res.statusCode ?? 0);
            stream.destroy();
          },
        );
        stream.on('error', reject);
      });
    try {
      expect(await statusFor({ Host: HOST })).toBe(401);
      expect(await statusFor(withToken('wrong'))).toBe(401);
      expect(await statusFor(LOCAL_HEADERS)).toBe(200);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('never writes the token to logs or responses', async () => {
    const logged: string[] = [];
    for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logged.push(args.map(String).join(' '));
      });
    }
    const responses = await Promise.all([
      request(app).get('/api/health').set(LOCAL_HEADERS),
      request(app).get('/api/conversations').set(LOCAL_HEADERS),
      request(app).get(`/api/conversations/${randomUUID()}`).set(LOCAL_HEADERS),
      request(app)
        .get('/api/health')
        .set(withToken(`${API_TOKEN}x`)),
      request(app)
        .post('/api/conversations')
        .set(LOCAL_HEADERS)
        .set('Origin', ORIGIN)
        .set('Content-Type', 'application/json')
        .send('{"broken'),
    ]);
    const exposed = [...logged, ...responses.map((response) => response.text)];
    expect(exposed.some((line) => line.includes(API_TOKEN))).toBe(false);
  });
});
