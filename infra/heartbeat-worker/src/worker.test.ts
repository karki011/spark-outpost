import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  handleRequest,
  HEARTBEAT_PATH,
  MAX_BODY_BYTES,
  type AnalyticsEngineDataPoint,
  type HeartbeatEnv,
} from './worker.ts';

const INSTALL_ID = '3f1c2a4e-9b7d-4c1e-8a2f-5d6e7f8a9b0c';
const ORIGIN = 'https://heartbeat.example';

const VALID = {
  installId: INSTALL_ID,
  version: '0.1.0-beta.1',
  os: 'darwin',
  arch: 'arm64',
  channel: 'beta',
};

function fakeEnv() {
  const points: AnalyticsEngineDataPoint[] = [];
  const env: HeartbeatEnv = { HEARTBEATS: { writeDataPoint: (point) => points.push(point) } };
  return { env, points };
}

interface PostOptions {
  body?: string;
  country?: string;
  method?: string;
  path?: string;
  contentType?: string;
}

function request({
  body = JSON.stringify(VALID),
  country = 'NP',
  method = 'POST',
  path = HEARTBEAT_PATH,
  contentType = 'application/json',
}: PostOptions = {}) {
  const init: RequestInit = {
    method,
    headers: { 'content-type': contentType, 'cf-connecting-ip': '203.0.113.7' },
  };
  if (method !== 'GET' && method !== 'HEAD') init.body = body;
  return Object.assign(new Request(`${ORIGIN}${path}`, init), { cf: { country } });
}

async function send(options: PostOptions = {}) {
  const { env, points } = fakeEnv();
  const response = await handleRequest(request(options), env);
  return { status: response.status, points, response };
}

describe('heartbeat worker', () => {
  it('writes one data point with the country and a hashed install id, and answers 204', async () => {
    const { status, points } = await send();

    expect(status).toBe(204);
    expect(points).toEqual([
      {
        blobs: ['NP', '0.1.0-beta.1', 'darwin', 'arm64', 'beta'],
        doubles: [1],
        indexes: [createHash('sha256').update(INSTALL_ID).digest('hex')],
      },
    ]);
  });

  it('never stores the raw install id or the client address', async () => {
    const { points } = await send();
    const stored = JSON.stringify(points);

    expect(stored).not.toContain(INSTALL_ID);
    expect(stored).not.toContain('203.0.113.7');
  });

  it('records an unknown country as XX', async () => {
    const { points } = await send({ country: '<script>' });
    expect(points[0]!.blobs[0]).toBe('XX');
  });

  it('accepts only POST on the heartbeat path', async () => {
    const wrongMethod = await send({ method: 'GET' });
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.response.headers.get('allow')).toBe('POST');
    expect((await send({ path: '/' })).status).toBe(404);
    expect((await send({ path: '/v1/heartbeat/extra' })).status).toBe(404);
  });

  it.each([
    ['not JSON', 'hello'],
    ['an array', '[]'],
    ['an unknown field', JSON.stringify({ ...VALID, hostname: 'macbook' })],
    ['a missing field', JSON.stringify({ ...VALID, channel: undefined })],
    ['a non-v4 install id', JSON.stringify({ ...VALID, installId: 'not-a-uuid' })],
    ['an uppercase install id', JSON.stringify({ ...VALID, installId: INSTALL_ID.toUpperCase() })],
    ['a free-form version', JSON.stringify({ ...VALID, version: 'latest' })],
    ['an unknown os', JSON.stringify({ ...VALID, os: 'plan9' })],
    ['an unknown arch', JSON.stringify({ ...VALID, arch: 'ia32' })],
    ['an unknown channel', JSON.stringify({ ...VALID, channel: 'nightly' })],
    ['an empty body', ''],
    ['an oversized body', JSON.stringify({ ...VALID, version: 'x'.repeat(MAX_BODY_BYTES) })],
  ])('rejects %s with 400 and writes nothing', async (_name, body) => {
    const { status, points } = await send({ body });

    expect(status).toBe(400);
    expect(points).toEqual([]);
  });

  it('rejects a body that is not declared as JSON', async () => {
    const { status, points } = await send({ contentType: 'text/plain' });

    expect(status).toBe(400);
    expect(points).toEqual([]);
  });
});
