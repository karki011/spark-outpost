// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarLine } from '../calendar/island-calendar.ts';
import { at, event } from '../calendar/test-fixtures.ts';
import type { IslandCalendar } from '../calendar/use-island-calendar.ts';
import { CalendarLineView } from './CalendarRestLine.tsx';

const standup = event('Standup', at(10, 30), at(10, 45));
const design = event('Design sync', at(10, 30), at(10, 50));

function line(overrides: Partial<CalendarLine>): CalendarLine {
  return {
    kind: 'nudge',
    key: 'before:x',
    eventKey: standup.key,
    text: 'Standup in 9 min',
    event: null,
    join: null,
    choose: null,
    capture: null,
    dismiss: 'meeting',
    meeting: { lead: 'Meeting in 9 min', title: 'Standup', sub: '10:30–10:45' },
    ...overrides,
  };
}

function show(shown: CalendarLine) {
  const onDismiss = vi.fn();
  const onClose = vi.fn();
  const calendar = {
    at: at(10, 21),
    onDismiss,
    onClose,
    calendarName: () => 'Work',
    onOpenEvent: vi.fn(),
    onJoined: vi.fn(),
  } as unknown as IslandCalendar;
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CalendarLineView line={shown} top={0} calendar={calendar} />
    </QueryClientProvider>,
  );
  return { onDismiss, onClose };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('CalendarLineView meeting line', () => {
  it('closes a meeting line from ✕, named for the meeting, without dismissing it', () => {
    const shown = line({});
    const { onDismiss, onClose } = show(shown);
    fireEvent.click(screen.getByRole('button', { name: 'Close the card for Standup' }));
    act(() => vi.advanceTimersByTime(400));
    expect(onClose).toHaveBeenCalledWith(shown);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('dismisses for good only from ···', () => {
    const shown = line({});
    const { onDismiss } = show(shown);
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    act(() => vi.advanceTimersByTime(400));
    expect(onDismiss).toHaveBeenCalledWith(shown);
  });

  it('shows the line as a meeting card: kicker, title and when', () => {
    show(line({}));
    expect(document.querySelector('.mc-kicker')?.textContent).toBe('Meeting in 9 min');
    expect(document.querySelector('.mc-title')?.textContent).toBe('Standup');
    expect(document.querySelector('.mc-row')?.textContent).toBe('10:30–10:45');
  });

  it('lists every meeting of a grouped line with its own action', () => {
    show(line({ choose: [standup, design] }));
    expect(screen.getByRole('button', { name: 'Close the card for 2 meetings' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open Standup' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open Design sync' })).toBeTruthy();
  });
});
