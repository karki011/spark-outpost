// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarEvent, CalendarNow, MeetingAlertPayload } from '@spark-outpost/contracts';
import { calendarApi } from './calendar-api.ts';
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

function nowWith(meeting: CalendarEvent = standup): CalendarNow {
  return {
    active: true,
    upcoming: [meeting],
    nudge: {
      kind: 'before',
      eventKey: meeting.key,
      title: meeting.title,
      startsAt: meeting.start,
      minutes: 5,
      group: [meeting],
    },
    hold: null,
    capture: null,
    clashes: [],
    calendars: [],
  };
}

function mount() {
  const home = { open: false, show: () => undefined, note: () => undefined };
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  return renderHook(() => useIslandCalendar(Date.now(), 0, [], () => undefined, home), {
    wrapper,
  });
}

const marked = vi.spyOn(calendarApi, 'mark');

beforeEach(() => {
  marked.mockResolvedValue({ ok: true });
  vi.useFakeTimers();
  vi.setSystemTime(at(10, 29, 10));
  calendarState.now = nowWith();
  calendarState.updatedAt = Date.now();
});

afterEach(() => {
  marked.mockReset();
  localStorage.clear();
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
    expect(hook.result.current.upcoming).toEqual([]);
    await act(async () => vi.advanceTimersByTimeAsync(121_000));
    expect(hook.result.current.line?.event?.key).toBe(standup.key);
  });

  it('saves Dismiss from the centre card so the meeting stays quiet', async () => {
    const bridge = fakeBridge();
    const hook = mount();
    await act(async () => vi.advanceTimersByTimeAsync(10));
    act(() => bridge.act({ kind: 'dismiss', key: standup.key, eventKey: null }));
    await act(async () => vi.advanceTimersByTimeAsync(10));
    expect(bridge.shown.at(-1)).toBeNull();
    expect(marked).toHaveBeenCalledWith({
      eventKey: standup.key,
      end: standup.end,
      kind: 'dismiss',
      on: true,
    });
    expect(hook.result.current.upcoming).toEqual([]);
    expect(hook.result.current.line).toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(5 * 60_000));
    expect(bridge.shown.at(-1)).toBeNull();
  });

  it('shows no card, line or meeting row for a meeting Spark has saved as dismissed', async () => {
    calendarState.now = nowWith({ ...standup, dismissed: true });
    const bridge = fakeBridge();
    const hook = mount();
    await act(async () => vi.advanceTimersByTimeAsync(10));
    expect(bridge.shown.filter(Boolean)).toEqual([]);
    expect(hook.result.current.line).toBeNull();
    expect(hook.result.current.upcoming).toEqual([]);
  });

  it('dismisses the bubble for good and clears the meeting row', async () => {
    vi.setSystemTime(at(10, 26));
    fakeBridge();
    const hook = mount();
    await act(async () => vi.advanceTimersByTimeAsync(10));
    act(() => hook.result.current.onDismissNudge(standup));
    await act(async () => vi.advanceTimersByTimeAsync(10));
    expect(hook.result.current.line).toBeNull();
    expect(hook.result.current.upcoming).toEqual([]);
    expect(marked).toHaveBeenCalledTimes(1);
  });

  it('keeps a snooze when the island reloads mid-snooze, and shows the card once it ends', async () => {
    const bridge = fakeBridge();
    const first = mount();
    await act(async () => vi.advanceTimersByTimeAsync(10));
    act(() => bridge.act({ kind: 'snooze', key: standup.key, eventKey: null }));
    await act(async () => vi.advanceTimersByTimeAsync(10));
    first.unmount();
    const again = fakeBridge();
    mount();
    await act(async () => vi.advanceTimersByTimeAsync(10));
    expect(again.shown.filter(Boolean)).toEqual([]);
    await act(async () => vi.advanceTimersByTimeAsync(61_000));
    expect(again.shown.at(-1)?.key).toBe(standup.key);
  });
});
