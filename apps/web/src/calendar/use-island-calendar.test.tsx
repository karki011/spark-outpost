// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarNow, MeetingAlertPayload } from '@spark-outpost/contracts';
import { at, event, link, status } from './test-fixtures.ts';

const calendarState = vi.hoisted(() => ({ now: null as CalendarNow | null, updatedAt: 0 }));

vi.mock('./use-calendar.ts', () => ({
  useCalendarStatus: () => ({ data: status() }),
  useCalendarNow: () => ({ data: calendarState.now, dataUpdatedAt: calendarState.updatedAt }),
}));

const { useIslandCalendar } = await import('./use-island-calendar.ts');

type Listener = (action: unknown) => void;

function fakeBridge() {
  const shown: (MeetingAlertPayload | null)[] = [];
  let listener: Listener = () => undefined;
  const meetingAlert = {
    show: (payload: MeetingAlertPayload) => shown.push(payload),
    hide: () => shown.push(null),
    onAction: (callback: Listener) => {
      listener = callback;
      return () => undefined;
    },
    presence: () => Promise.resolve({ idleSeconds: 0, locked: false, asleep: false }),
    autoJoined: () => undefined,
  };
  vi.stubGlobal('sparkDesktop', { meetingAlert, island: {} });
  return { shown, act: (action: unknown) => listener(action) };
}

const standup = event('Standup', at(10, 30), at(10, 45), { link: link('zoom') });

function nowWith(): CalendarNow {
  return {
    active: true,
    upcoming: [standup],
    nudge: {
      kind: 'before',
      eventKey: standup.key,
      title: standup.title,
      startsAt: standup.start,
      minutes: 5,
      group: [standup],
    },
    hold: null,
    capture: null,
    clashes: [],
    calendars: [],
  };
}

function mount() {
  const home = { open: false, show: () => undefined, note: () => undefined };
  return renderHook(() => useIslandCalendar(Date.now(), 0, [], () => undefined, home));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(at(10, 29, 10));
  calendarState.now = nowWith();
  calendarState.updatedAt = Date.now();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useIslandCalendar meeting alert', () => {
  it('hides the alert on Snooze and shows it once more after a minute', async () => {
    const bridge = fakeBridge();
    mount();
    await act(async () => vi.advanceTimersByTimeAsync(10));
    expect(bridge.shown.at(-1)?.key).toBe(standup.key);
    act(() => bridge.act({ kind: 'snooze', key: standup.key, eventKey: null }));
    await act(async () => vi.advanceTimersByTimeAsync(10));
    expect(bridge.shown.at(-1)).toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(bridge.shown.at(-1)).toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(31_000));
    expect(bridge.shown.at(-1)?.key).toBe(standup.key);
  });

  it('hides the bubble on Snooze and brings it back once the snooze ends', async () => {
    vi.setSystemTime(at(10, 26));
    fakeBridge();
    const hook = mount();
    await act(async () => vi.advanceTimersByTimeAsync(10));
    expect(hook.result.current.line?.event?.key).toBe(standup.key);
    act(() => hook.result.current.onSnooze(standup));
    await act(async () => vi.advanceTimersByTimeAsync(10));
    expect(hook.result.current.line).toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(121_000));
    expect(hook.result.current.line?.event?.key).toBe(standup.key);
  });
});
