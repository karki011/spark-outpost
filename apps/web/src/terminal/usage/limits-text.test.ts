import { describe, expect, it } from 'vitest';
import { limitRows, resetWhen } from './limits-text.ts';

const clock = (at: number) => new Date(at).toISOString().slice(11, 16);

describe('Claude Code’s usage limits in the Terminal cost pane', () => {
  it('names the 5-hour and 7-day windows with how much is used and when each resets', () => {
    const rows = limitRows(
      {
        at: '2026-11-18T18:00:00.000Z',
        context: { tokens: 50_000, window: 200_000, percent: 25 },
        rateLimits: [
          { kind: 'five_hour', percentUsed: 23.5, resetsAt: '2026-11-18T20:00:00Z' },
          { kind: 'seven_day', percentUsed: 7, resetsAt: null },
          { kind: 'some_new_window', percentUsed: 1, resetsAt: 'not a date' },
        ],
        costUsd: 1.2,
      },
      clock,
    );
    expect(rows.map(({ name, value, detail }) => [name, value, detail])).toEqual([
      ['5-hour limit', '23.5% used', 'resets 20:00'],
      ['7-day limit', '7% used', null],
      ['some new window', '1% used', null],
      ['Context', '25% full', '50K of 200K tokens'],
    ]);
  });

  it('names a window whose kind matches a built-in object key as plain text', () => {
    const rows = limitRows(
      {
        at: 'x',
        context: null,
        rateLimits: [{ kind: 'constructor', percentUsed: 1, resetsAt: null }],
        costUsd: null,
      },
      clock,
    );
    expect(rows[0]?.name).toBe('constructor');
  });

  it('shows nothing off a subscription before any context reading', () => {
    expect(limitRows({ at: 'x', context: null, rateLimits: [], costUsd: null }, clock)).toEqual([]);
  });

  it('adds the day to a reset after today and keeps today’s reset to the time', () => {
    const now = new Date(2026, 10, 18, 9, 0).getTime();
    const tonight = new Date(2026, 10, 18, 20, 0).getTime();
    const nextWeek = new Date(2026, 10, 25, 20, 0).getTime();
    const day = new Date(nextWeek).toLocaleDateString(undefined, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
    expect(resetWhen(tonight, now, () => '20:00')).toBe('20:00');
    expect(resetWhen(nextWeek, now, () => '20:00')).toBe(`${day} 20:00`);
  });
});
