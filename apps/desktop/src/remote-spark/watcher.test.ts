import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  REMOTE_ACCESS_COOKIE,
  REMOTE_DEVICE_COOKIE,
  REMOTE_SPARK_WATCH_MS,
  remoteSparkPartition,
} from '@spark-outpost/contracts';
import type { WorkerBridge } from '../browser/bridge.ts';
import { desk, fakeElectron, FakePower, type FakeSession } from './electron.fixture.ts';
import { startRemoteSparkHost, type RemoteSparkHost } from './host.ts';
import { REMOTE_SPARK_CHECK_TIMEOUT_MS } from './watcher.ts';

vi.mock('electron', async () => (await import('./electron.fixture.ts')).fakeElectron);

const ID = '11111111-2222-4333-8444-555555555555';
const OTHER_ID = '22222222-3333-4444-8555-666666666666';
const HOST = 'studio.tail1234.ts.net';
const OTHER_HOST = 'laptop.tail1234.ts.net';
const ATTENTION = `https://${HOST}/api/attention`;
const studio = { id: ID, hostname: HOST, cookie: 'saved-value' };
const laptop = { id: OTHER_ID, hostname: OTHER_HOST, cookie: 'laptop-value' };

function item(key: string, marks: Record<string, unknown> = {}) {
  return {
    key,
    kind: 'approval',
    blocking: true,
    conversationId: null,
    detail: null,
    at: '2026-11-25T10:00:00.000Z',
    readAt: null,
    setAsideAt: null,
    dismissedAt: null,
    ...marks,
  };
}

const waiting = (count: number) => ({
  status: 200,
  body: { items: Array.from({ length: count }, (_, index) => item(`approval:${index}`)) },
});
const status = (id: string, reach: 'online' | 'offline', needsYou: number) => ({
  kind: 'remote-spark:status',
  id,
  status: reach,
  needsYou,
});

let host: RemoteSparkHost;
let bridge: WorkerBridge;
let posted: unknown[];
let logged: string[];
let power: FakePower;

const sessionOf = (id: string): FakeSession =>
  fakeElectron.session.fromPartition(remoteSparkPartition(id));
const watch = (...sparks: unknown[]) => bridge.receive({ kind: 'remote-spark:watch', sparks });
const settle = () => vi.advanceTimersByTimeAsync(0);
const nextCheck = () => vi.advanceTimersByTimeAsync(REMOTE_SPARK_WATCH_MS);

beforeEach(() => {
  vi.useFakeTimers();
  desk.reset();
  posted = [];
  logged = [];
  power = new FakePower();
  host = startRemoteSparkHost({
    blockedPorts: () => new Set([32682]),
    power,
    openExternal: () => undefined,
    log: (line) => logged.push(line),
  });
  bridge = host.connect({ post: (message) => posted.push(message) });
});

afterEach(() => {
  host.dispose();
  vi.useRealTimers();
});

describe('watching a saved Spark', () => {
  it('places the saved cookie, asks at once and reports the first result', async () => {
    sessionOf(ID).attention = waiting(2);
    watch(studio);
    await settle();
    const target = sessionOf(ID);
    expect(target.cookies.placed).toEqual([
      {
        url: `https://${HOST}`,
        name: REMOTE_DEVICE_COOKIE,
        value: 'saved-value',
        path: '/',
        secure: true,
        httpOnly: true,
        sameSite: 'strict',
      },
    ]);
    expect(target.fetched).toEqual([ATTENTION]);
    expect(posted).toEqual([status(ID, 'online', 2)]);
    expect(desk.windows).toEqual([]);
  });

  it('counts only blocking items that are not read, set aside or dismissed', async () => {
    sessionOf(ID).attention = {
      status: 200,
      body: {
        items: [
          item('approval:1'),
          item('approval:2', { readAt: '2026-11-25T10:01:00.000Z' }),
          item('approval:3', { setAsideAt: '2026-11-25T10:01:00.000Z' }),
          item('approval:4', { dismissedAt: '2026-11-25T10:01:00.000Z' }),
          item('run-done:5', { kind: 'run-done', blocking: false }),
        ],
      },
    };
    watch(studio);
    await settle();
    expect(posted).toEqual([status(ID, 'online', 1)]);
  });

  it('asks again every minute and reports only a change', async () => {
    watch(studio);
    await settle();
    await nextCheck();
    await nextCheck();
    expect(sessionOf(ID).fetched).toHaveLength(3);
    expect(posted).toEqual([status(ID, 'online', 0)]);

    sessionOf(ID).attention = waiting(3);
    await nextCheck();
    await nextCheck();
    expect(posted).toEqual([status(ID, 'online', 0), status(ID, 'online', 3)]);

    sessionOf(ID).attention = 'unreachable';
    await nextCheck();
    expect(posted.at(-1)).toEqual(status(ID, 'offline', 0));
    expect(posted).toHaveLength(3);
  });

  it('keeps a cookie the session already holds', async () => {
    const target = sessionOf(ID);
    target.cookies.hostSets(REMOTE_DEVICE_COOKIE, HOST, 'newer-value');
    watch(studio);
    await settle();
    await nextCheck();
    expect(target.cookies.placed).toEqual([]);
    expect(target.cookies.held.get(`${HOST} ${REMOTE_DEVICE_COOKIE}`)).toBe('newer-value');
    expect(posted).toEqual([status(ID, 'online', 0)]);
  });

  it('places a saved sign-in for the page in front of the address before asking', async () => {
    watch({ ...studio, access: 'saved-sign-in' });
    await settle();
    const { cookies } = sessionOf(ID);
    expect(cookies.placed.map((cookie) => [cookie.name, cookie.value])).toEqual([
      [REMOTE_DEVICE_COOKIE, 'saved-value'],
      [REMOTE_ACCESS_COOKIE, 'saved-sign-in'],
    ]);
    await nextCheck();
    expect(cookies.placed).toHaveLength(2);
  });

  it('never logs or reports a cookie value', async () => {
    sessionOf(ID).cookies.failing = true;
    watch(studio);
    await settle();
    expect(posted).toEqual([status(ID, 'offline', 0)]);
    expect(sessionOf(ID).fetched).toEqual([]);
    expect(JSON.stringify([posted, logged])).not.toContain('saved-value');
  });
});

describe('a watched Spark that refuses the sign-in', () => {
  it('reports signed out, removes the cookie and stops asking', async () => {
    sessionOf(ID).attention = { status: 401, body: { error: 'Sign in.' } };
    watch(studio);
    await settle();
    const target = sessionOf(ID);
    expect(posted).toEqual([{ kind: 'remote-spark:signed-out', id: ID }]);
    expect(target.cookies.removed).toEqual([`https://${HOST} ${REMOTE_DEVICE_COOKIE}`]);
    await nextCheck();
    await nextCheck();
    expect(target.fetched).toHaveLength(1);
    expect(posted).toHaveLength(1);
  });

  it('is watched again when a later list names it', async () => {
    sessionOf(ID).attention = { status: 401, body: null };
    watch(studio);
    await settle();
    sessionOf(ID).attention = waiting(1);
    watch({ ...studio, cookie: 'fresh-value' });
    await settle();
    expect(sessionOf(ID).cookies.placed.map((cookie) => cookie.value)).toEqual([
      'saved-value',
      'fresh-value',
    ]);
    expect(posted.at(-1)).toEqual(status(ID, 'online', 1));
  });
});

describe('a watched Spark that does not answer properly', () => {
  it.each([
    ['a network error', 'unreachable' as const],
    ['a missing route', { status: 404, body: { error: 'Not found.' } }],
    ['a gateway error', { status: 502, body: null }],
    ['a body that is not JSON', { status: 200, body: undefined }],
    ['a body of another shape', { status: 200, body: { items: [{ key: 'approval:1' }] } }],
    ['a body with no list', { status: 200, body: 'ok' }],
  ])('is offline with nothing waiting after %s', async (_name, answer) => {
    sessionOf(ID).attention = answer;
    watch(studio);
    await settle();
    expect(posted).toEqual([status(ID, 'offline', 0)]);
    expect(sessionOf(ID).cookies.removed).toEqual([]);
  });

  it('gives up on an answer after ten seconds', async () => {
    sessionOf(ID).attention = 'silent';
    watch(studio);
    await vi.advanceTimersByTimeAsync(REMOTE_SPARK_CHECK_TIMEOUT_MS - 1);
    expect(posted).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(posted).toEqual([status(ID, 'offline', 0)]);
  });
});

describe('a new watch list', () => {
  it('stops the Sparks it leaves out and keeps the others running', async () => {
    watch(studio, laptop);
    await settle();
    expect(posted).toEqual([status(ID, 'online', 0), status(OTHER_ID, 'online', 0)]);

    await vi.advanceTimersByTimeAsync(REMOTE_SPARK_WATCH_MS - 1000);
    watch(laptop);
    await settle();
    expect(sessionOf(OTHER_ID).fetched).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(sessionOf(OTHER_ID).fetched).toHaveLength(2);
    await nextCheck();
    expect(sessionOf(ID).fetched).toHaveLength(1);
    expect(sessionOf(OTHER_ID).fetched).toHaveLength(3);
    expect(posted).toHaveLength(2);
  });

  it('reports the first result again for a Spark that comes back', async () => {
    watch(studio);
    await settle();
    watch();
    await nextCheck();
    expect(sessionOf(ID).fetched).toHaveLength(1);
    watch(studio);
    await settle();
    expect(posted).toEqual([status(ID, 'online', 0), status(ID, 'online', 0)]);
  });

  it('drops the answer of a check that was running when its Spark was removed', async () => {
    sessionOf(ID).attention = 'silent';
    watch(studio);
    await settle();
    watch();
    await vi.advanceTimersByTimeAsync(REMOTE_SPARK_CHECK_TIMEOUT_MS);
    expect(posted).toEqual([]);
  });

  it('ignores a malformed list and keeps watching', async () => {
    watch(studio);
    await settle();
    for (const raw of [
      { kind: 'remote-spark:watch' },
      { kind: 'remote-spark:watch', sparks: 'none' },
      { kind: 'remote-spark:watch', sparks: [{ ...laptop, id: 'not-a-uuid' }] },
      { kind: 'remote-spark:watch', sparks: [{ ...laptop, cookie: '' }] },
      { kind: 'remote-spark:watch', sparks: [{ ...laptop, hostname: `https://${OTHER_HOST}/` }] },
    ]) {
      bridge.receive(raw);
    }
    await nextCheck();
    expect(sessionOf(ID).fetched).toHaveLength(2);
    expect(desk.sessions.has(remoteSparkPartition(OTHER_ID))).toBe(false);
    expect(posted).toEqual([status(ID, 'online', 0)]);
  });
});

describe('while this Mac sleeps', () => {
  it('stops checking on suspend and reports nothing', async () => {
    watch(studio, laptop);
    await settle();
    posted.length = 0;
    power.sleeps();
    expect(vi.getTimerCount()).toBe(0);
    await nextCheck();
    await nextCheck();
    expect(sessionOf(ID).fetched).toHaveLength(1);
    expect(sessionOf(OTHER_ID).fetched).toHaveLength(1);
    expect(posted).toEqual([]);
  });

  it('checks every Spark at once on resume and goes back to checking each minute', async () => {
    watch(studio, laptop);
    await settle();
    posted.length = 0;
    power.sleeps();
    sessionOf(ID).attention = waiting(3);
    power.wakes();
    await settle();
    expect(sessionOf(ID).fetched).toHaveLength(2);
    expect(sessionOf(OTHER_ID).fetched).toHaveLength(2);
    expect(posted).toEqual([status(ID, 'online', 3)]);
    await nextCheck();
    expect(sessionOf(ID).fetched).toHaveLength(3);
    expect(sessionOf(OTHER_ID).fetched).toHaveLength(3);
  });

  it('drops the answer of a check that sleep cut short and asks again on resume', async () => {
    watch(studio);
    await settle();
    posted.length = 0;
    sessionOf(ID).attention = 'silent';
    await nextCheck();
    power.sleeps();
    sessionOf(ID).attention = waiting(1);
    power.wakes();
    await settle();
    expect(posted).toEqual([status(ID, 'online', 1)]);
    await vi.advanceTimersByTimeAsync(REMOTE_SPARK_CHECK_TIMEOUT_MS);
    expect(posted).toEqual([status(ID, 'online', 1)]);
  });

  it('starts no check for a Spark added during sleep until resume', async () => {
    power.sleeps();
    watch(studio);
    await nextCheck();
    expect(sessionOf(ID).fetched).toEqual([]);
    power.wakes();
    await settle();
    expect(sessionOf(ID).fetched).toEqual([ATTENTION]);
    expect(posted).toEqual([status(ID, 'online', 0)]);
  });

  it('stops listening for sleep when the app quits', async () => {
    watch(studio);
    await settle();
    host.dispose();
    expect(power.listenerCount('suspend') + power.listenerCount('resume')).toBe(0);
  });
});

describe('stopping the watch', () => {
  it('stops every timer when the app quits', async () => {
    watch(studio, laptop);
    await settle();
    host.dispose();
    await nextCheck();
    expect(vi.getTimerCount()).toBe(0);
    expect(sessionOf(ID).fetched).toHaveLength(1);
    expect(sessionOf(OTHER_ID).fetched).toHaveLength(1);
  });

  it('stops when the process that asked goes away', async () => {
    watch(studio);
    await settle();
    bridge.close();
    await nextCheck();
    expect(vi.getTimerCount()).toBe(0);
    expect(sessionOf(ID).fetched).toHaveLength(1);
  });

  it('stops watching a Spark the user removed', async () => {
    watch(studio);
    await settle();
    bridge.receive({ kind: 'remote-spark:close', id: ID });
    await nextCheck();
    expect(sessionOf(ID).fetched).toHaveLength(1);
    expect(sessionOf(ID).cookies.placed).toHaveLength(1);
  });
});
