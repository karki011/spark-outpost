import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { markRemote } from '../remote/principal.ts';
import { compressRemoteJson } from './json-compression.ts';

const servers: Array<{ close(): void }> = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

async function serve(remote: boolean): Promise<string> {
  const app = express();
  app.use((_req, res, next) => {
    if (remote) markRemote(res);
    next();
  });
  app.use(compressRemoteJson());
  app.get('/big', (_req, res) => res.json({ text: 'spark '.repeat(2000) }));
  app.get('/small', (_req, res) => res.json({ ok: true }));
  app.get('/stream', (_req, res) => {
    res.set('Content-Type', 'text/event-stream');
    res.write(`data: ${'x'.repeat(4000)}\n\n`);
    res.end();
  });
  app.get('/file', (_req, res) => res.type('text/plain').send('y'.repeat(4000)));
  const server = app.listen(0, '127.0.0.1');
  servers.push(server);
  await new Promise((resolve) => server.once('listening', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function raw(url: string, encoding = 'gzip') {
  const response = await fetch(url, { headers: { 'Accept-Encoding': encoding } });
  return response;
}

describe('compressRemoteJson', () => {
  it('gzips a large JSON reply for a paired device', async () => {
    const origin = await serve(true);
    const response = await raw(`${origin}/big`);
    expect(response.headers.get('content-encoding')).toBe('gzip');
    expect(response.headers.get('vary')).toContain('Accept-Encoding');
    const body = (await response.json()) as { text: string };
    expect(body.text).toHaveLength(12_000);
  });

  it('leaves the Mac, small replies, streams and other types alone', async () => {
    const local = await serve(false);
    expect((await raw(`${local}/big`)).headers.get('content-encoding')).toBeNull();
    const remote = await serve(true);
    expect((await raw(`${remote}/small`)).headers.get('content-encoding')).toBeNull();
    expect((await raw(`${remote}/stream`)).headers.get('content-encoding')).toBeNull();
    expect((await raw(`${remote}/file`)).headers.get('content-encoding')).toBeNull();
    expect((await raw(`${remote}/big`, 'identity')).headers.get('content-encoding')).toBeNull();
  });
});
