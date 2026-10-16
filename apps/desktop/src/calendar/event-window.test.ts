import { describe, expect, it, vi } from 'vitest';
import { connectCalendarBridge } from './bridge.ts';
import {
  createEventWindow,
  nextRefreshMs,
  windowRange,
  WINDOW_REFRESH_MS,
  type Timers,
} from './event-window.ts';
import { CalendarHelperError } from './helper-process.ts';
import { seedPlan } from './seed.ts';

function manualTimers() {
  const pending = new Map<number, { run: () => void; ms: number }>();
  let next = 0;
  const timers: Timers = {
    setTimeout: (run, ms) => {
      next += 1;
      pending.set(next, { run, ms });
      return next;
    },
    clearTimeout: (handle) => pending.delete(handle as number),
  };
  const fire = () => {
    const entries = [...pending];
    pending.clear();
    for (const [, entry] of entries) entry.run();
  };
  return { timers, pending, fire };
}

const NOW = new Date(2026, 9, 16, 9, 0).getTime();

describe('the event window', () => {
  it('covers yesterday to a week ahead in local days', () => {
    const range = windowRange(NOW);
    expect(new Date(range.from).getTime()).toBe(new Date(2026, 9, 15).getTime());
    expect(new Date(range.to).getTime()).toBe(new Date(2026, 9, 24).getTime());
  });

  it('refreshes every 15 min, and just after midnight when that comes first', () => {
    expect(nextRefreshMs(NOW)).toBe(WINDOW_REFRESH_MS);
    const late = new Date(2026, 9, 16, 23, 55).getTime();
    expect(nextRefreshMs(late)).toBe(5 * 60_000 + 1_000);
  });

  it('reads once, then again after a change, telling listeners', async () => {
    const call = vi.fn(async () => ({ events: [], truncated: false }));
    const changed = vi.fn();
    const { timers, pending, fire } = manualTimers();
    const window = createEventWindow({
      helper: { call } as never,
      now: () => NOW,
      changed,
      timers,
    });
    await window.read();
    await window.read();
    expect(call).toHaveBeenCalledTimes(1);
    expect(pending.size).toBe(1);
    window.invalidate();
    expect(changed).toHaveBeenCalledTimes(1);
    expect(pending.size).toBe(0);
    await window.read();
    expect(call).toHaveBeenCalledTimes(2);
    fire();
    expect(changed).toHaveBeenCalledTimes(2);
    await window.read();
    expect(call).toHaveBeenCalledTimes(3);
  });

  it('says nothing before the first read and stops refreshing when stopped', async () => {
    const call = vi.fn(async () => ({ events: [], truncated: false }));
    const changed = vi.fn();
    const { timers, pending } = manualTimers();
    const window = createEventWindow({
      helper: { call } as never,
      now: () => NOW,
      changed,
      timers,
    });
    window.invalidate();
    expect(changed).not.toHaveBeenCalled();
    await window.read();
    window.stop();
    expect(pending.size).toBe(0);
    window.invalidate();
    expect(changed).not.toHaveBeenCalled();
  });

  it('reads again after a failed read', async () => {
    const call = vi
      .fn()
      .mockRejectedValueOnce(new CalendarHelperError('not_authorized', 'No access.'))
      .mockResolvedValue({ events: [], truncated: true });
    const window = createEventWindow({
      helper: { call } as never,
      now: () => NOW,
      changed: vi.fn(),
    });
    await expect(window.read()).rejects.toMatchObject({ code: 'not_authorized' });
    await expect(window.read()).resolves.toMatchObject({ truncated: true });
    window.stop();
  });
});

describe('the calendar bridge', () => {
  it('answers requests, maps helper errors and posts changes', async () => {
    const posted: unknown[] = [];
    const bridge = connectCalendarBridge(
      { post: (message) => posted.push(message) },
      async (request) => {
        if (request.op === 'status') return { helper: 'ready', authorization: 'fullAccess' };
        throw new CalendarHelperError('not_authorized', 'No access.');
      },
    );
    bridge.receive({ kind: 'calendar:request', id: 'a', request: { op: 'status' } });
    bridge.receive({ kind: 'calendar:request', id: 'b', request: { op: 'calendars' } });
    bridge.receive({ kind: 'calendar:request', id: 'c', request: { op: 'delete_everything' } });
    bridge.receive({ kind: 'browser:request', id: 'd', request: { op: 'tabs' } });
    bridge.changed();
    await vi.waitFor(() => expect(posted).toHaveLength(4));
    expect(posted).toContainEqual({
      kind: 'calendar:response',
      id: 'a',
      ok: true,
      result: { helper: 'ready', authorization: 'fullAccess' },
    });
    expect(posted).toContainEqual(
      expect.objectContaining({ id: 'b', ok: false, code: 'not_authorized' }),
    );
    expect(posted).toContainEqual(expect.objectContaining({ id: 'c', ok: false, code: 'invalid' }));
    expect(posted).toContainEqual({ kind: 'calendar:changed' });
    bridge.close();
    bridge.changed();
    expect(posted).toHaveLength(4);
  });
});

describe('the test seed', () => {
  const exists = () => true;

  it('runs only with a seed binary, a mode and a state file', () => {
    const env = { SPARK_CALENDAR_SEED: 'seed', SPARK_CALENDAR_SEED_STATE: '/tmp/state.json' };
    expect(seedPlan({ seedPath: '/seed', env, log: () => undefined }, exists)).toEqual({
      mode: 'seed',
      binary: '/seed',
      state: '/tmp/state.json',
    });
    expect(seedPlan({ seedPath: null, env, log: () => undefined }, exists)).toBeNull();
    expect(
      seedPlan(
        { seedPath: '/seed', env: { ...env, SPARK_CALENDAR_SEED: 'wipe' }, log: () => undefined },
        exists,
      ),
    ).toBeNull();
    expect(
      seedPlan(
        { seedPath: '/seed', env: { SPARK_CALENDAR_SEED: 'remove' }, log: () => undefined },
        exists,
      ),
    ).toBeNull();
    expect(seedPlan({ seedPath: '/seed', env, log: () => undefined }, () => false)).toBeNull();
  });
});
