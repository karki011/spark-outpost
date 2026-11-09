// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarEvent, CalendarNow, MeetingAlertPayload } from '@spark-outpost/contracts';
import { calendarApi } from './calendar-api.ts';
import type { IslandHomePanel } from './use-island-calendar.ts';
import { useMeetingAlert } from './use-meeting-alert.ts';
import { at, event, link, status } from './test-fixtures.ts';

const calendarState = vi.hoisted(() => ({ now: null as CalendarNow | null, updatedAt: 0 }));

vi.mock('./use-calendar.ts', () => ({
  useCalendarStatus: () => ({ data: status() }),
  useCalendarNow: () => ({ data: calendarState.now, dataUpdatedAt: calendarState.updatedAt }),
}));

const { DISMISS_RETRY_MS, JOIN_AT_START_NOTE_MS, useIslandCalendar } =
  await import('./use-island-calendar.ts');

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

function mount(minute?: number, open = false, note: IslandHomePanel['note'] = () => undefined) {
  const home = { open, show: () => undefined, note };
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  return renderHook(() => useIslandCalendar(minute ?? Date.now(), 0, [], () => undefined, home), {
    wrapper,
  });
}

const marked = vi.spyOn(calendarApi, 'mark');

beforeEach(() => {
  marked.mockResolvedValue({ ok: true });
  vi.useFakeTimers();
  vi.setSystemTime(at(10, 30, 10));
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
  it('expires the native alert 5 min after the start even when the caller clock stays fixed', async () => {
    vi.setSystemTime(at(10, 34, 59));
    const bridge = fakeBridge();
    const options = {
      live: nowWith(),
      settings: status().settings,
      at: Date.now(),
      held: false,
      marks: new Map(),
      setMarks: () => undefined,
      names: new Map(),
      note: () => undefined,
      onDismissed: vi.fn(),
      onJoinAtStart: vi.fn(),
    };
    renderHook(() => useMeetingAlert(options));
    expect(bridge.shown.at(-1)?.key).toBe(standup.key);
    await act(async () => vi.advanceTimersByTimeAsync(999));
    expect(bridge.shown.at(-1)?.key).toBe(standup.key);
    await act(async () => vi.advanceTimersByTimeAsync(51));
    expect(bridge.shown.at(-1)).toBeNull();
    expect(options.onDismissed).not.toHaveBeenCalled();
  });

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

  it('keeps a snoozed meeting quiet across reload until its scheduled start', async () => {
    vi.setSystemTime(at(10, 21));
    const bridge = fakeBridge();
    const hook = mount();
    act(() => hook.result.current.onSnooze(standup, true));
    expect(hook.result.current.line).toBeNull();
    hook.unmount();
    const restored = mount();
    expect(restored.result.current.line).toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(9 * 60_000 - 1));
    expect(restored.result.current.line).toBeNull();
    expect(restored.result.current.upcoming).toEqual([]);
    expect(bridge.shown.at(-1)).toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(51));
    expect(restored.result.current.upcoming.map((meeting) => meeting.key)).toContain(standup.key);
    expect(bridge.shown.at(-1)?.key).toBe(standup.key);
  });

  it('does not create a past snooze when the meeting starts before the click completes', () => {
    const hook = mount();
    act(() => hook.result.current.onSnooze(standup, true));
    expect(hook.result.current.upcoming.map((meeting) => meeting.key)).toContain(standup.key);
    expect(localStorage.getItem('spark-outpost.calendar-snoozes')).toBe('[]');
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

  it('saves Dismiss again when the first save fails', async () => {
    marked.mockRejectedValueOnce(new Error('offline'));
    const bridge = fakeBridge();
    mount();
    await act(async () => vi.advanceTimersByTimeAsync(10));
    act(() => bridge.act({ kind: 'dismiss', key: standup.key, eventKey: null }));
    await act(async () => vi.advanceTimersByTimeAsync(10));
    expect(marked).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(DISMISS_RETRY_MS));
    expect(marked).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTimeAsync(DISMISS_RETRY_MS));
    expect(marked).toHaveBeenCalledTimes(2);
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

describe('useIslandCalendar island line', () => {
  it('expires the bubble and chooser at the end of meetings shorter than 5 min', async () => {
    vi.setSystemTime(at(10, 32, 59));
    const quick = event('Standup', at(10, 30), at(10, 33), { link: link('zoom') });
    const design = event('Design sync', at(10, 30), at(10, 33));
    calendarState.now = {
      ...nowWith(quick),
      upcoming: [quick, design],
      nudge: { ...nowWith(quick).nudge!, group: [quick, design] } as CalendarNow['nudge'],
    };
    const hook = mount(at(10, 32), true);
    act(() => hook.result.current.onChoose(hook.result.current.line!));
    expect(hook.result.current.choosing).toHaveLength(2);
    await act(async () => vi.advanceTimersByTimeAsync(999));
    expect(hook.result.current.line).not.toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(51));
    expect(hook.result.current.line).toBeNull();
    expect(hook.result.current.choosing).toBeNull();
    expect(hook.result.current.upcoming).toEqual([]);
    expect(marked).not.toHaveBeenCalled();
  });

  it('hides the native meeting alert 5 min after the start without dismissing it', async () => {
    vi.setSystemTime(at(10, 34, 59));
    const bridge = fakeBridge();
    mount(at(10, 34));
    expect(bridge.shown.at(-1)?.key).toBe(standup.key);
    await act(async () => vi.advanceTimersByTimeAsync(999));
    expect(bridge.shown.at(-1)?.key).toBe(standup.key);
    await act(async () => vi.advanceTimersByTimeAsync(51));
    expect(bridge.shown.at(-1)).toBeNull();
    expect(marked).not.toHaveBeenCalled();
  });

  it('counts down each minute even when the island clock lags a minute behind', async () => {
    vi.setSystemTime(at(10, 26, 30));
    fakeBridge();
    const hook = mount(at(10, 26));
    await act(async () => vi.advanceTimersByTimeAsync(10));
    expect(hook.result.current.line?.text).toBe('Standup in 4 min');
    await act(async () => vi.advanceTimersByTimeAsync(40_000));
    expect(hook.result.current.line?.text).toBe('Standup in 3 min');
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(hook.result.current.line?.text).toBe('Standup in 2 min');
  });

  it('names the meeting for the notification and joins from its Join button', async () => {
    const opened = vi.spyOn(window, 'open').mockReturnValue(null);
    const bridge = fakeBridge();
    mount();
    await act(async () => vi.advanceTimersByTimeAsync(10));
    expect(bridge.shown.at(-1)?.notice.title).toBe('Standup');
    act(() => bridge.act({ kind: 'join', key: standup.key, eventKey: standup.key }));
    await act(async () => vi.advanceTimersByTimeAsync(10));
    expect(opened).toHaveBeenCalledWith(standup.link!.url, '_blank', 'noopener,noreferrer');
    expect(bridge.shown.at(-1)).toBeNull();
    opened.mockRestore();
  });

  it('ignores a Join from a notification for an alert that is gone', async () => {
    const opened = vi.spyOn(window, 'open').mockReturnValue(null);
    const bridge = fakeBridge();
    mount();
    await act(async () => vi.advanceTimersByTimeAsync(10));
    act(() => bridge.act({ kind: 'join', key: 'old-alert', eventKey: standup.key }));
    expect(opened).not.toHaveBeenCalled();
    opened.mockRestore();
  });

  it('drops the line for a meeting once it is joined', async () => {
    vi.setSystemTime(at(10, 26));
    fakeBridge();
    const hook = mount();
    await act(async () => vi.advanceTimersByTimeAsync(10));
    expect(hook.result.current.line?.event?.key).toBe(standup.key);
    act(() => hook.result.current.onJoined(standup.key));
    await act(async () => vi.advanceTimersByTimeAsync(10));
    expect(hook.result.current.line).toBeNull();
  });

  it('takes dismissed and snoozed meetings out of Choose', async () => {
    vi.setSystemTime(at(10, 26));
    const design = event('Design sync', at(10, 30), at(10, 50), { link: link('meet') });
    calendarState.now = {
      ...nowWith(),
      upcoming: [standup, design],
      nudge: { ...nowWith().nudge!, group: [standup, design] } as CalendarNow['nudge'],
    };
    fakeBridge();
    const hook = mount(undefined, true);
    await act(async () => vi.advanceTimersByTimeAsync(10));
    act(() => hook.result.current.onChoose(hook.result.current.line!));
    expect(hook.result.current.choosing).toHaveLength(2);
    act(() => hook.result.current.onDismissNudge(standup));
    await act(async () => vi.advanceTimersByTimeAsync(10));
    expect(hook.result.current.choosing?.map((meeting) => meeting.key)).toEqual([design.key]);
    act(() => hook.result.current.onSnoozeAlert(design));
    await act(async () => vi.advanceTimersByTimeAsync(10));
    expect(hook.result.current.choosing).toBeNull();
  });
});

describe('useIslandCalendar meeting line Dismiss', () => {
  it('dismisses every meeting of a grouped line for good', async () => {
    vi.setSystemTime(at(10, 26));
    const design = event('Design sync', at(10, 30), at(10, 50), { link: link('meet') });
    calendarState.now = {
      ...nowWith(),
      upcoming: [standup, design],
      nudge: { ...nowWith().nudge!, group: [standup, design] } as CalendarNow['nudge'],
    };
    fakeBridge();
    const hook = mount();
    await act(async () => vi.advanceTimersByTimeAsync(10));
    expect(hook.result.current.line).toMatchObject({ dismiss: 'meeting' });
    act(() => hook.result.current.onDismiss(hook.result.current.line!));
    await act(async () => vi.advanceTimersByTimeAsync(10));
    expect(hook.result.current.line).toBeNull();
    const saved = marked.mock.calls.map(([mark]) => [mark.eventKey, mark.kind, mark.on]);
    expect(saved).toEqual([
      [standup.key, 'dismiss', true],
      [design.key, 'dismiss', true],
    ]);
  });
});

describe('useIslandCalendar Join at start', () => {
  beforeEach(() => vi.setSystemTime(at(10, 26)));

  it('confirms for 4 s, keeps reminding, then joins once with the switch off', async () => {
    const opened = vi.spyOn(window, 'open').mockReturnValue(null);
    const note = vi.fn();
    const bridge = fakeBridge();
    const hook = mount(undefined, false, note);
    await act(async () => vi.advanceTimersByTimeAsync(10));
    act(() => hook.result.current.onJoinAtStart(standup));
    await act(async () => vi.advanceTimersByTimeAsync(10));
    expect(marked).toHaveBeenLastCalledWith(
      expect.objectContaining({ eventKey: standup.key, kind: 'join_at_start', on: true }),
    );
    expect(note).toHaveBeenCalledWith(
      expect.stringMatching(/^Opens at /),
      standup.title,
      JOIN_AT_START_NOTE_MS,
    );
    expect(JOIN_AT_START_NOTE_MS).toBe(4_000);
    expect(hook.result.current.line?.kind).toBe('nudge');
    await act(async () => vi.advanceTimersByTimeAsync(4 * 60_000));
    expect(bridge.shown.at(-1)?.key).toBe(standup.key);
    expect(hook.result.current.countdown?.eventKey).toBe(standup.key);
    await act(async () => vi.advanceTimersByTimeAsync(11_000));
    expect(opened).toHaveBeenCalledTimes(1);
    expect(marked).toHaveBeenLastCalledWith(
      expect.objectContaining({ eventKey: standup.key, kind: 'join_at_start', on: false }),
    );
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(opened).toHaveBeenCalledTimes(1);
    opened.mockRestore();
  });

  it("clears the mark with Don't open, and nothing opens at the start", async () => {
    const opened = vi.spyOn(window, 'open').mockReturnValue(null);
    const bridge = fakeBridge();
    const hook = mount();
    await act(async () => vi.advanceTimersByTimeAsync(10));
    act(() => hook.result.current.onJoinAtStart(standup));
    await act(async () => vi.advanceTimersByTimeAsync(10));
    act(() => hook.result.current.onCancelJoinAtStart(standup));
    await act(async () => vi.advanceTimersByTimeAsync(10));
    expect(marked).toHaveBeenLastCalledWith(expect.objectContaining({ on: false }));
    await act(async () => vi.advanceTimersByTimeAsync(4 * 60_000 + 20_000));
    expect(bridge.shown.at(-1)?.key).toBe(standup.key);
    expect(hook.result.current.countdown).toBeNull();
    expect(opened).not.toHaveBeenCalled();
    opened.mockRestore();
  });

  it('keeps a saved request across a reload', async () => {
    const opened = vi.spyOn(window, 'open').mockReturnValue(null);
    calendarState.now = nowWith({ ...standup, joinAtStart: true });
    const bridge = fakeBridge();
    const hook = mount();
    await act(async () => vi.advanceTimersByTimeAsync(10));
    expect(hook.result.current.line?.kind).toBe('nudge');
    await act(async () => vi.advanceTimersByTimeAsync(4 * 60_000));
    expect(bridge.shown.at(-1)?.key).toBe(standup.key);
    await act(async () => vi.advanceTimersByTimeAsync(11_000));
    expect(opened).toHaveBeenCalledTimes(1);
    opened.mockRestore();
  });

  it('asks from the centre card before the start', () => {
    const bridge = fakeBridge();
    const options = {
      live: nowWith(),
      settings: { ...status().settings, alertLead: 5 as const },
      at: Date.now(),
      held: false,
      marks: new Map(),
      setMarks: () => undefined,
      names: new Map(),
      note: () => undefined,
      onDismissed: vi.fn(),
      onJoinAtStart: vi.fn(),
    };
    renderHook(() => useMeetingAlert(options));
    expect(bridge.shown.at(-1)?.key).toBe(standup.key);
    act(() => bridge.act({ kind: 'join-at-start', key: standup.key, eventKey: standup.key }));
    expect(options.onJoinAtStart).toHaveBeenCalledWith(standup, true);
    act(() =>
      bridge.act({ kind: 'cancel-join-at-start', key: standup.key, eventKey: standup.key }),
    );
    expect(options.onJoinAtStart).toHaveBeenLastCalledWith(standup, false);
  });
});
