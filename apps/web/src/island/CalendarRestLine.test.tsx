// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
  const calendar = { at: at(10, 21), onDismiss } as unknown as IslandCalendar;
  render(<CalendarLineView line={shown} top={0} calendar={calendar} />);
  return onDismiss;
}

afterEach(cleanup);

describe('CalendarLineView meeting line', () => {
  it('dismisses a meeting line, named for the meeting', () => {
    const shown = line({});
    const onDismiss = show(shown);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss the nudge for Standup' }));
    expect(onDismiss).toHaveBeenCalledWith(shown);
  });

  it('names every meeting of a grouped line', () => {
    show(line({ choose: [standup, design] }));
    expect(
      screen.getByRole('button', { name: 'Dismiss 2 meetings: Standup, Design sync' }),
    ).toBeTruthy();
  });

  it('offers Cancel, not Dismiss, while a meeting is set to open at its start', () => {
    show(
      line({
        kind: 'join-at-start',
        dismiss: 'join_at_start',
        text: 'Opens Standup at 10:30',
        meeting: { lead: 'Opens at 10:30', title: 'Standup', sub: '10:30–10:45' },
      }),
    );
    expect(screen.getByText('Opens at 10:30')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel: Opens Standup at 10:30' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Dismiss/ })).toBeNull();
  });
});
