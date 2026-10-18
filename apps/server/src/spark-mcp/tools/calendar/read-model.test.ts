import { describe, expect, it } from 'vitest';
import { addLocalDays, localDayStart, type CalendarEvent } from '@spark-outpost/contracts';
import { freeTime, matchesQuery, rangeOf } from './read-model.ts';

const NOW = new Date(2026, 9, 18, 9, 30).getTime();
const TODAY = localDayStart(NOW);

describe('the range a read covers', () => {
  it('defaults to today and takes dates or times with an offset', () => {
    expect(rangeOf(undefined, undefined, NOW)).toEqual({
      start: TODAY,
      end: addLocalDays(TODAY, 1),
    });
    expect(rangeOf('2026-10-19', '2026-10-21', NOW)).toEqual({
      start: addLocalDays(TODAY, 1),
      end: addLocalDays(TODAY, 3),
    });
    const at = '2026-10-19T15:00:00+02:00';
    expect(rangeOf(at, undefined, NOW).start).toBe(Date.parse(at));
  });

  it('refuses a backwards range, a bad date and more than 62 days', () => {
    expect(() => rangeOf('2026-10-20', '2026-10-19', NOW)).toThrow('after from');
    expect(() => rangeOf('next week', undefined, NOW)).toThrow('YYYY-MM-DD');
    expect(() => rangeOf('2026-10-01', '2026-12-31', NOW)).toThrow('62 days');
    expect(rangeOf('2026-10-01', '2026-12-02', NOW).end).toBe(new Date(2026, 11, 2).getTime());
  });
});

describe('free time', () => {
  it('lists working-hour gaps long enough, per day', () => {
    const busy = {
      start: new Date(2026, 9, 18, 10).toISOString(),
      end: new Date(2026, 9, 18, 11).toISOString(),
      busy: true,
    } as CalendarEvent;
    const [day] = freeTime([busy], { start: TODAY, end: addLocalDays(TODAY, 1) }, 60);
    expect(day!.date).toBe('2026-10-18');
    expect(day!.free.map((block) => block.minutes)).toEqual([60, 420]);
  });

  it('matches titles containing the query', () => {
    const event = { title: 'Design review' } as CalendarEvent;
    expect(matchesQuery(event, 'review')).toBe(true);
    expect(matchesQuery(event, 'standup')).toBe(false);
    expect(matchesQuery(event, undefined)).toBe(true);
  });
});
