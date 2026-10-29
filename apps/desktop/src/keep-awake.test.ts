import { REMOTE_SWITCH_DEFAULTS } from '@spark-outpost/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  needsKeepAwake,
  readKeepAwake,
  startKeepAwake,
  type KeepAwakeReading,
  type PowerBlocker,
} from './keep-awake.ts';

const ORIGIN = 'http://127.0.0.1:4000';
const EVERY = 30_000;

afterEach(() => {
  vi.useRealTimers();
});

function reading(change: Partial<KeepAwakeReading> = {}): KeepAwakeReading {
  return { phoneAccess: true, activeRuns: 0, phoneConnected: false, ...change };
}

function device(connected: boolean, revokedAt: string | null = null) {
  return {
    id: crypto.randomUUID(),
    name: 'Phone',
    createdAt: '2026-10-01T00:00:00.000Z',
    lastSeenAt: '2026-10-28T00:00:00.000Z',
    revokedAt,
    replacedBy: null,
    duplicateOf: null,
    expired: false,
    connected,
    passkeys: [],
  };
}

function api(routes: Record<string, unknown>) {
  const asked: string[] = [];
  const fetchImpl = (async (url: string) => {
    const route = url.slice(ORIGIN.length);
    asked.push(route);
    if (!(route in routes)) return new Response('missing', { status: 404 });
    return Response.json(routes[route]);
  }) as typeof fetch;
  return { asked, fetchImpl };
}

const ACCESS_ON = { hostname: 'mac.tail.ts.net', switches: REMOTE_SWITCH_DEFAULTS };

function fakeBlocker() {
  const held = new Set<number>();
  let next = 1;
  const blocker: PowerBlocker = {
    start: vi.fn(() => {
      held.add(next);
      return next++;
    }),
    stop: vi.fn((id: number) => {
      held.delete(id);
    }),
  };
  return { blocker, held };
}

describe('deciding whether to keep the Mac awake', () => {
  it('holds only while phone access is on and work runs or a phone is connected', () => {
    expect(needsKeepAwake(reading({ activeRuns: 2 }))).toBe(true);
    expect(needsKeepAwake(reading({ phoneConnected: true }))).toBe(true);
    expect(needsKeepAwake(reading())).toBe(false);
    expect(needsKeepAwake(reading({ phoneAccess: false, activeRuns: 3 }))).toBe(false);
    expect(needsKeepAwake(reading({ phoneAccess: false, phoneConnected: true }))).toBe(false);
    expect(needsKeepAwake(null)).toBe(false);
  });
});

describe('reading what keep-awake needs from the API', () => {
  it('asks nothing more once phone access is off', async () => {
    const { asked, fetchImpl } = api({
      '/api/remote/access': { hostname: null, switches: REMOTE_SWITCH_DEFAULTS },
    });
    expect(await readKeepAwake(ORIGIN, 'token', fetchImpl)).toEqual(
      reading({ phoneAccess: false }),
    );
    expect(asked).toEqual(['/api/remote/access']);
  });

  it('counts active runs and skips the device list while work runs', async () => {
    const { asked, fetchImpl } = api({
      '/api/remote/access': ACCESS_ON,
      '/api/runs/active': { activeRuns: 2 },
    });
    expect(await readKeepAwake(ORIGIN, 'token', fetchImpl)).toEqual(reading({ activeRuns: 2 }));
    expect(asked).toEqual(['/api/remote/access', '/api/runs/active']);
  });

  it('sees a connected phone, ignoring a revoked one', async () => {
    const connected = api({
      '/api/remote/access': ACCESS_ON,
      '/api/runs/active': { activeRuns: 0 },
      '/api/remote/devices': { devices: [device(false), device(true)] },
    });
    expect(await readKeepAwake(ORIGIN, 'token', connected.fetchImpl)).toEqual(
      reading({ phoneConnected: true }),
    );
    const revoked = api({
      '/api/remote/access': ACCESS_ON,
      '/api/runs/active': { activeRuns: 0 },
      '/api/remote/devices': { devices: [device(true, '2026-10-27T00:00:00.000Z')] },
    });
    expect(await readKeepAwake(ORIGIN, 'token', revoked.fetchImpl)).toEqual(reading());
  });

  it('gives no reading when the API cannot be read', async () => {
    const { fetchImpl } = api({ '/api/remote/access': ACCESS_ON });
    expect(await readKeepAwake(ORIGIN, 'token', fetchImpl)).toBeNull();
    const down = (() => Promise.reject(new Error('connection refused'))) as typeof fetch;
    expect(await readKeepAwake(ORIGIN, 'token', down)).toBeNull();
  });
});

describe('holding the power assertion', () => {
  it('takes one hold while work runs and releases it when work stops', async () => {
    vi.useFakeTimers();
    const readings = [reading({ activeRuns: 1 }), reading({ activeRuns: 2 }), reading()];
    const read = vi.fn(() => Promise.resolve(readings.shift() ?? reading()));
    const { blocker, held } = fakeBlocker();
    const keepAwake = startKeepAwake({ read, blocker, log: () => undefined, everyMs: EVERY });

    await vi.advanceTimersByTimeAsync(0);
    expect(held.size).toBe(1);
    await vi.advanceTimersByTimeAsync(EVERY);
    expect(blocker.start).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(EVERY);
    expect(held.size).toBe(0);
    keepAwake.dispose();
  });

  it('releases the hold when the API stops answering', async () => {
    vi.useFakeTimers();
    const readings: (KeepAwakeReading | null)[] = [reading({ phoneConnected: true }), null];
    const read = vi.fn(() => Promise.resolve(readings.shift() ?? null));
    const { blocker, held } = fakeBlocker();
    const keepAwake = startKeepAwake({ read, blocker, log: () => undefined, everyMs: EVERY });

    await vi.advanceTimersByTimeAsync(0);
    expect(held.size).toBe(1);
    await vi.advanceTimersByTimeAsync(EVERY);
    expect(held.size).toBe(0);
    keepAwake.dispose();
  });

  it('never overlaps checks and holds nothing after it is disposed', async () => {
    vi.useFakeTimers();
    let answer: (value: KeepAwakeReading) => void = () => undefined;
    const read = vi.fn(
      () =>
        new Promise<KeepAwakeReading>((resolve) => {
          answer = resolve;
        }),
    );
    const { blocker, held } = fakeBlocker();
    const keepAwake = startKeepAwake({ read, blocker, log: () => undefined, everyMs: EVERY });

    await vi.advanceTimersByTimeAsync(3 * EVERY);
    expect(read).toHaveBeenCalledTimes(1);

    keepAwake.dispose();
    answer(reading({ activeRuns: 1 }));
    await vi.advanceTimersByTimeAsync(0);
    expect(held.size).toBe(0);
    expect(blocker.start).not.toHaveBeenCalled();
  });

  it('releases a held assertion when disposed on quit', async () => {
    vi.useFakeTimers();
    const read = vi.fn(() => Promise.resolve(reading({ activeRuns: 1 })));
    const { blocker, held } = fakeBlocker();
    const keepAwake = startKeepAwake({ read, blocker, log: () => undefined, everyMs: EVERY });
    await vi.advanceTimersByTimeAsync(0);
    expect(held.size).toBe(1);

    keepAwake.dispose();

    expect(held.size).toBe(0);
    await vi.advanceTimersByTimeAsync(EVERY);
    expect(read).toHaveBeenCalledTimes(1);
  });
});
