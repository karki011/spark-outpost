import { describe, expect, it } from 'vitest';
import { formatClock, formatHour, formatSpan, localeHourCycle } from './clock-format.ts';

const at = (hour: number, minute = 0) => new Date(2026, 9, 19, hour, minute).getTime();

describe('clock times', () => {
  it('shows 12-hour times with AM and PM, and 24-hour times without', () => {
    expect(formatClock(at(18, 49), 'h12')).toBe('6:49 PM');
    expect(formatClock(at(0, 5), 'h12')).toBe('12:05 AM');
    expect(formatClock(at(12, 0), 'h12')).toBe('12:00 PM');
    expect(formatClock(at(18, 49), 'h23')).toBe('18:49');
    expect(formatClock(at(9, 5), 'h23')).toBe('9:05');
  });

  it('says AM or PM once when a range stays on one side of noon', () => {
    expect(formatSpan(at(9, 45), at(10), 'h12')).toBe('9:45–10:00 AM');
    expect(formatSpan(at(18, 49), at(19, 4), 'h12')).toBe('6:49–7:04 PM');
    expect(formatSpan(at(11, 30), at(12, 15), 'h12')).toBe('11:30 AM–12:15 PM');
    expect(formatSpan(at(23, 30), at(0, 30) + 86_400_000, 'h12')).toBe('11:30 PM–12:30 AM');
    expect(formatSpan(at(11, 30), at(12, 15), 'h23')).toBe('11:30–12:15');
  });

  it('labels whole hours on the day timeline', () => {
    expect(formatHour(at(9), 'h12')).toBe('9 AM');
    expect(formatHour(at(0), 'h12')).toBe('12 AM');
    expect(formatHour(at(13), 'h23')).toBe('13:00');
  });

  it('defaults to the locale convention', () => {
    expect(localeHourCycle('en-US')).toBe('h12');
    expect(localeHourCycle('en-GB')).toBe('h23');
    expect(localeHourCycle('de-DE')).toBe('h23');
  });
});
