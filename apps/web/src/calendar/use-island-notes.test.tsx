// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarNow } from '@spark-outpost/contracts';
import { meetingsApi } from '../meetings/index.ts';
import type { IslandHomePanel } from './use-island-calendar.ts';
import { useMeetingAlert } from './use-meeting-alert.ts';
import { at, event, link, status } from './test-fixtures.ts';

const calendarState = vi.hoisted(() => ({ now: null as CalendarNow | null, notesOnJoin: false }));

vi.mock('./use-calendar.ts', () => ({
  useCalendarStatus: () => {
    const data = status();
    return {
      data: { ...data, settings: { ...data.settings, notesOnJoin: calendarState.notesOnJoin } },
    };
  },
  useCalendarNow: () => ({ data: calendarState.now, dataUpdatedAt: Date.now() }),
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

  it('reports a Join pressed on the centre card as yours', () => {
    const bridge = fakeBridge();
    const onUserJoined = vi.fn();
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
        onUserJoined,
      }),
    );
    act(() => bridge.act({ kind: 'joined', key: standup.key, eventKey: standup.key }));
    expect(onUserJoined).toHaveBeenCalledWith(standup);
  });
});
