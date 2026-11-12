import { describe, expect, it } from 'vitest';
import type { CalendarChoice } from '@spark-outpost/contracts';
import { eventTip } from './event-tip.ts';
import { at, event, WORK } from './test-fixtures.ts';

const work = { key: WORK, title: 'Spark Work' } as CalendarChoice;

describe('eventTip', () => {
  it('gives the full title, time, calendar and reply word', () => {
    const pending = event('Design review with the whole platform team', at(13), at(14), {
      myStatus: 'pending',
    });
    expect(eventTip(pending, work)).toBe(
      'Design review with the whole platform team · 1:00–2:00 PM · Spark Work · Not answered',
    );
  });

  it('leaves out the reply word when there is none and says All day for all-day events', () => {
    const holiday = event('Company holiday', at(0), at(23), { allDay: true, myStatus: 'none' });
    expect(eventTip(holiday, undefined)).toBe('Company holiday · All day');
  });
});
