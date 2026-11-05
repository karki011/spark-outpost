import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FIRST_HEARTBEAT_MS,
  HEARTBEAT_INTERVAL_MS,
  heartbeatEnabled,
  heartbeatUrl,
  installIdFile,
  loadInstallId,
  readBakedHeartbeatUrl,
  sendHeartbeat,
  startHeartbeat,
  type Heartbeat,
} from './heartbeat.ts';

const URL_OK = 'https://spark-outpost-heartbeat.example.workers.dev/v1/heartbeat';
const ORIGIN = 'http://127.0.0.1:50002';
const BEAT: Heartbeat = {
  installId: '3f1c2a4e-9b7d-4c1e-8a2f-5d6e7f8a9b0c',
  version: '0.1.0-beta.1',
  os: 'darwin',
  arch: 'arm64',
  channel: 'beta',
};

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'spark-heartbeat-'));
});

afterEach(async () => {
  vi.useRealTimers();
  await rm(dir, { recursive: true, force: true });
});

describe('heartbeatUrl', () => {
  it('accepts https and loopback http only', () => {
    expect(heartbeatUrl(URL_OK)).toBe(URL_OK);
    expect(heartbeatUrl(' http://localhost:8787/v1/heartbeat ')).toBe(
      'http://localhost:8787/v1/heartbeat',
    );
    expect(heartbeatUrl('http://example.com/v1/heartbeat')).toBeNull();
    expect(heartbeatUrl('https://user:secret@example.com/v1/heartbeat')).toBeNull();
    expect(heartbeatUrl('not a url')).toBeNull();
    expect(heartbeatUrl('')).toBeNull();
    expect(heartbeatUrl(undefined)).toBeNull();
  });
});

describe('readBakedHeartbeatUrl', () => {
  it('reads the packaged address and is off without one', async () => {
    await writeFile(path.join(dir, 'package.json'), JSON.stringify({ heartbeatUrl: URL_OK }));
    expect(await readBakedHeartbeatUrl(dir)).toBe(URL_OK);
    await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'x' }));
    expect(await readBakedHeartbeatUrl(dir)).toBeNull();
    expect(await readBakedHeartbeatUrl(path.join(dir, 'missing'))).toBeNull();
  });
});

describe('loadInstallId', () => {
  it('creates a random v4 id once, keeps it private, and reuses it', async () => {
    const file = installIdFile(dir);
    const first = await loadInstallId(file);

    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(await loadInstallId(file)).toBe(first);
    expect((await readFile(file, 'utf8')).trim()).toBe(first);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  it('replaces an unreadable id with a new one', async () => {
    const file = installIdFile(dir);
    await writeFile(file, 'garbage');
    expect(await loadInstallId(file)).not.toBe('garbage');
  });
});

describe('heartbeatEnabled', () => {
  it('reads the setting with the launch token', async () => {
    let token: string | null = null;
    const fetchImpl: typeof fetch = async (_input, init) => {
      token = new Headers(init?.headers).get('x-spark-token');
      return Response.json({ profile: { heartbeat: true } });
    };

    expect(await heartbeatEnabled(ORIGIN, 'tok', fetchImpl)).toBe(true);
    expect(token).toBe('tok');
  });

  it('stays off when the setting is off or unknown', async () => {
    const answer =
      (status: number, body: unknown): typeof fetch =>
      async () =>
        Response.json(body, { status });
    const failing: typeof fetch = async () => {
      throw new Error('ECONNREFUSED');
    };

    expect(
      await heartbeatEnabled(ORIGIN, 'tok', answer(200, { profile: { heartbeat: false } })),
    ).toBe(false);
    expect(await heartbeatEnabled(ORIGIN, 'tok', answer(500, {}))).toBe(false);
    expect(await heartbeatEnabled(ORIGIN, 'tok', failing)).toBe(false);
  });
});

describe('sendHeartbeat', () => {
  it('posts exactly the heartbeat fields as JSON', async () => {
    let seen: { method: string | undefined; type: string | null; body: unknown } | null = null;
    const fetchImpl: typeof fetch = async (_input, init) => {
      seen = {
        method: init?.method,
        type: new Headers(init?.headers).get('content-type'),
        body: JSON.parse(String(init?.body)),
      };
      return new Response(null, { status: 204 });
    };

    expect(await sendHeartbeat(URL_OK, BEAT, fetchImpl)).toBe(true);
    expect(seen).toEqual({ method: 'POST', type: 'application/json', body: BEAT });
  });

  it('never throws when the network fails', async () => {
    const failing: typeof fetch = async () => {
      throw new Error('offline');
    };
    expect(await sendHeartbeat(URL_OK, BEAT, failing)).toBe(false);
  });
});

describe('startHeartbeat', () => {
  function schedule(enabled: () => Promise<boolean>, url: string | null = URL_OK) {
    const sent: string[] = [];
    const timer = startHeartbeat({
      url,
      enabled,
      heartbeat: async () => BEAT,
      send: async (target) => {
        sent.push(target);
        return true;
      },
    });
    return { sent, timer };
  }

  it('sends after the launch delay and then once a day', async () => {
    vi.useFakeTimers();
    const { sent, timer } = schedule(async () => true);

    await vi.advanceTimersByTimeAsync(FIRST_HEARTBEAT_MS - 1);
    expect(sent).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(sent).toEqual([URL_OK]);
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS);
    expect(sent).toHaveLength(2);

    timer.dispose();
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS);
    expect(sent).toHaveLength(2);
  });

  it('skips a beat while the setting is off and resumes when it is on', async () => {
    vi.useFakeTimers();
    let on = false;
    const { sent, timer } = schedule(async () => on);

    await vi.advanceTimersByTimeAsync(FIRST_HEARTBEAT_MS);
    expect(sent).toEqual([]);
    on = true;
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS);
    expect(sent).toEqual([URL_OK]);
    timer.dispose();
  });

  it('does nothing without an address', async () => {
    vi.useFakeTimers();
    const enabled = vi.fn(async () => true);
    const { sent } = schedule(enabled, null);

    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS * 2);
    expect(sent).toEqual([]);
    expect(enabled).not.toHaveBeenCalled();
  });

  it('swallows failures so the app never sees them', async () => {
    vi.useFakeTimers();
    const { timer } = schedule(async () => {
      throw new Error('API down');
    });

    await vi.advanceTimersByTimeAsync(FIRST_HEARTBEAT_MS);
    timer.dispose();
  });
});
