import { describe, expect, it } from 'vitest';
import { defaultTimes, eventSpan, parseGuests } from './new-event-model.ts';

describe('defaultTimes', () => {
  it('starts at the next half hour today and at nine on another day', () => {
    const now = new Date(2026, 10, 24, 10, 10).getTime();
    expect(defaultTimes('2026-11-24', '2026-11-24', now)).toEqual({
      date: '2026-11-24',
      start: '10:30',
      end: '11:00',
    });
    expect(defaultTimes('2026-11-26', '2026-11-24', now)).toMatchObject({ start: '09:00' });
  });

  it('falls back to nine when the next half hour would cross midnight', () => {
    const late = new Date(2026, 10, 24, 23, 40).getTime();
    expect(defaultTimes('2026-11-24', '2026-11-24', late)).toMatchObject({ start: '09:00' });
  });
});

describe('eventSpan', () => {
  it('builds the local start and end, and refuses an end that is not after the start', () => {
    const span = eventSpan({ date: '2026-11-24', start: '14:00', end: '14:45' });
    expect(span).toEqual({
      start: new Date(2026, 10, 24, 14, 0).toISOString(),
      end: new Date(2026, 10, 24, 14, 45).toISOString(),
    });
    expect(eventSpan({ date: '2026-11-24', start: '14:00', end: '14:00' })).toBeNull();
  });
});

describe('parseGuests', () => {
  it('splits on commas and spaces, lowercases and drops repeats', () => {
    expect(parseGuests('Ana@Example.com, ivan@example.com  ana@example.com')).toEqual({
      emails: ['ana@example.com', 'ivan@example.com'],
      problem: null,
    });
    expect(parseGuests('')).toEqual({ emails: [], problem: null });
  });

  it('names the first entry that is not an address', () => {
    expect(parseGuests('ana@example.com, ivan').problem).toBe('“ivan” is not an email address.');
  });
});
