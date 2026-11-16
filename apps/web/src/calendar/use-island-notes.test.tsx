// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarEvent, CalendarNow } from '@spark-outpost/contracts';
import { meetingsApi } from '../meetings/index.ts';
import { calendarApi } from './calendar-api.ts';
import type { IslandHomePanel } from './use-island-calendar.ts';
import { useMeetingAlert } from './use-meeting-alert.ts';
import { at, event, link, status } from './test-fixtures.ts';

const calendarState = vi.hoisted(() => ({
  now: null as CalendarNow | null,
  updatedAt: 0,
  notesOnJoin: false,
}));

vi.mock('./use-calendar.ts', () => ({
  useCalendarStatus: () => {
    const data = status();
    return {
      data: { ...data, settings: { ...data.settings, notesOnJoin: calendarState.notesOnJoin } },
    };
  },
  useCalendarNow: () => ({ data: calendarState.now, dataUpdatedAt: calendarState.updatedAt }),
}));

const { useIslandCalendar } = await import('./use-island-calendar.ts');

const standup = event('Standup', at(10, 30), at(10, 45), { link: link('zoom') });

function nowWith(): CalendarNow {
  return {
    active: true,
    upcoming: [standup],
    nudge: null,
    hold: null,
    capture: null,
    clashes: [],
    calendars: [],
  };
}

function mount(note: IslandHomePanel['note'] = () => undefined) {
  const home = { open: false, show: () => undefined, note };
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  return renderHook(() => useIslandCalendar(Date.now(), 0, [], home), { wrapper });
}

function fakeBridge() {
  let listener: (action: unknown) => void = () => undefined;
  const meetingAlert = {
    show: () => undefined,
    hide: () => undefined,
    onAction: (callback: (action: unknown) => void) => {
      listener = callback;
      return () => undefined;
    },
    presence: () => Promise.resolve({ idleSeconds: 0, locked: false, asleep: false }),
    autoJoined: () => undefined,
  };
  vi.stubGlobal('sparkDesktop', { meetingAlert, island: {} });
  return { act: (action: unknown) => listener(action) };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(at(10, 30, 10));
  calendarState.now = nowWith();
  calendarState.updatedAt = Date.now();
});

afterEach(() => {
  calendarState.notesOnJoin = false;
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('notes when you join from the island or the centre card', () => {
  it('starts notes on a Join press when the setting is on, and says why when it cannot', async () => {
    calendarState.notesOnJoin = true;
    const joinNotes = vi
      .spyOn(meetingsApi, 'joinNotes')
      .mockResolvedValue({ detail: null, problem: 'Turn on Voice to take notes.' });
    const note = vi.fn();
    const { result } = mount(note);
    await act(async () => {
      result.current.onJoined(standup.key);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(joinNotes).toHaveBeenCalledWith(expect.objectContaining({ eventKey: standup.key }));
    expect(note).toHaveBeenCalledWith(
      'Notes didn’t start: Turn on Voice to take notes.',
      'Standup',
      8_000,
    );
    joinNotes.mockRestore();
  });

  it('opens the transcript, where the recording bar shows, once notes start', async () => {
    calendarState.notesOnJoin = true;
    const opened: string[] = [];
    vi.stubGlobal('sparkDesktop', {
      island: { openSettings: (target: string) => opened.push(target) },
    });
    const MEETING = '00000000-0000-4000-8000-0000000000dd';
    const joinNotes = vi
      .spyOn(meetingsApi, 'joinNotes')
      .mockResolvedValue({ detail: { meeting: { id: MEETING } } as never, problem: null });
    const { result } = mount();
    await act(async () => {
      result.current.onJoined(standup.key);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(opened).toEqual([`today:meeting:${MEETING}`]);
    joinNotes.mockRestore();
  });

  it('takes notes when Join at start opens the meeting', async () => {
    vi.setSystemTime(at(10, 26));
    calendarState.updatedAt = Date.now();
    calendarState.notesOnJoin = true;
    fakeBridge();
    const opened = vi.fn(() => null);
    vi.stubGlobal('open', opened);
    const marked = vi.spyOn(calendarApi, 'mark').mockResolvedValue({ ok: true });
    const joinNotes = vi
      .spyOn(meetingsApi, 'joinNotes')
      .mockResolvedValue({ detail: null, problem: null });
    const { result } = mount();
    await act(async () => vi.advanceTimersByTimeAsync(10));
    act(() => result.current.onJoinAtStart(standup));
    await act(async () => vi.advanceTimersByTimeAsync(10));
    await act(async () => vi.advanceTimersByTimeAsync(4 * 60_000));
    await act(async () => vi.advanceTimersByTimeAsync(11_000));
    expect(opened).toHaveBeenCalledTimes(1);
    expect(joinNotes).toHaveBeenCalledTimes(1);
    expect(joinNotes).toHaveBeenCalledWith(expect.objectContaining({ eventKey: standup.key }));
    joinNotes.mockRestore();
    marked.mockRestore();
  });

  it('starts nothing when the setting is off', async () => {
    const joinNotes = vi.spyOn(meetingsApi, 'joinNotes');
    const { result } = mount();
    await act(async () => {
      result.current.onJoined(standup.key);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(joinNotes).not.toHaveBeenCalled();
    joinNotes.mockRestore();
  });

  function alertHook(onJoinTakesNotes: (event: CalendarEvent) => void) {
    return renderHook(() =>
      useMeetingAlert({
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
        onJoinTakesNotes,
      }),
    );
  }

  it('takes notes for the notification’s Join', () => {
    const bridge = fakeBridge();
    vi.stubGlobal('open', () => null);
    const onJoinTakesNotes = vi.fn();
    alertHook(onJoinTakesNotes);
    act(() => bridge.act({ kind: 'join', key: standup.key, eventKey: standup.key }));
    expect(onJoinTakesNotes).toHaveBeenCalledWith(standup);
  });

  it('never takes notes for Ask Spark’s join', () => {
    fakeBridge();
    vi.stubGlobal('open', () => null);
    const onJoinTakesNotes = vi.fn();
    const { result } = alertHook(onJoinTakesNotes);
    act(() => result.current.joinEvent(standup));
    expect(onJoinTakesNotes).not.toHaveBeenCalled();
  });

  it('reports a Join pressed on the centre card as yours', () => {
    const bridge = fakeBridge();
    const onJoinTakesNotes = vi.fn();
    renderHook(() =>
      useMeetingAlert({
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
        onJoinTakesNotes,
      }),
    );
    act(() => bridge.act({ kind: 'joined', key: standup.key, eventKey: standup.key }));
    expect(onJoinTakesNotes).toHaveBeenCalledWith(standup);
  });
});
