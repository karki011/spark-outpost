import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, localDate, resolveWindow, windowDates } from './window.ts';

const now = new Date('2026-09-27T02:00:00Z');

describe('analytics window', () => {
  it('ends on the viewer’s local today', () => {
    expect(localDate(now, 'UTC')).toBe('2026-09-27');
    expect(localDate(now, 'America/Los_Angeles')).toBe('2026-09-26');
    expect(resolveWindow({ range: '7d' }, 'America/Los_Angeles', now)).toEqual({
      range: '7d',
      from: '2026-09-20',
      to: '2026-09-26',
      days: 7,
      timeZone: 'America/Los_Angeles',
    });
  });

  it('accepts custom ranges up to 366 days', () => {
    expect(
      resolveWindow({ range: 'custom', from: '2026-02-27', to: '2026-03-02' }, 'UTC', now),
    ).toMatchObject({ days: 4 });
    expect(
      resolveWindow({ range: 'custom', from: '2025-01-01', to: '2026-01-02' }, 'UTC', now),
    ).toBeNull();
  });

  it('lists every date, across month ends', () => {
    expect(windowDates({ from: '2026-02-27', days: 3 })).toEqual([
      '2026-02-27',
      '2026-02-28',
      '2026-03-01',
    ]);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(daysBetween('2026-03-29', '2026-03-30')).toBe(2);
  });
});
