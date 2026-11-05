import { describe, expect, it } from 'vitest';
import { clockLabel, clockParts, clockTitle } from './rail-clock-format.ts';

const AFTERNOON = new Date(2026, 9, 17, 16, 30);
const MORNING = new Date(2026, 9, 17, 9, 5);

const textOf = (kind: string, date: Date, locale: string) =>
  clockParts(date, locale)
    .filter((part) => part.kind === kind)
    .map((part) => part.text)
    .join('');

const face = (date: Date, locale: string) =>
  clockParts(date, locale)
    .map((part) => part.text)
    .join('')
    .replace(/\s/g, ' ');

describe('rail clock in a 12-hour locale', () => {
  it('shows two-digit hours and minutes with the day period apart', () => {
    expect(face(AFTERNOON, 'en-US')).toBe('04:30 PM');
    expect(textOf('hour', AFTERNOON, 'en-US')).toBe('04');
    expect(textOf('minute', AFTERNOON, 'en-US')).toBe('30');
    expect(textOf('period', AFTERNOON, 'en-US')).toBe('PM');
    expect(face(MORNING, 'en-US')).toBe('09:05 AM');
  });

  it('names the time without a leading zero and with plain spaces', () => {
    expect(clockLabel(AFTERNOON, 'en-US')).toBe('4:30 PM');
    expect(clockLabel(MORNING, 'en-US')).toBe('9:05 AM');
  });

  it('gives the full date and time for the tooltip', () => {
    expect(clockTitle(AFTERNOON, 'en-US')).toBe('Saturday, October 17, 2026 at 4:30 PM');
  });
});

describe('rail clock in a 24-hour locale', () => {
  it('shows the 24-hour time with no day period', () => {
    expect(face(AFTERNOON, 'en-GB')).toBe('16:30');
    expect(face(MORNING, 'en-GB')).toBe('09:05');
    expect(textOf('period', AFTERNOON, 'en-GB')).toBe('');
  });

  it('names the 24-hour time', () => {
    expect(clockLabel(AFTERNOON, 'en-GB')).toBe('16:30');
    expect(clockLabel(MORNING, 'en-GB')).toBe('9:05');
    expect(clockLabel(AFTERNOON, 'en-US', 'h23')).toBe('16:30');
  });

  it('honours a locale that asks for a 24-hour cycle', () => {
    expect(face(AFTERNOON, 'en-US-u-hc-h23')).toBe('16:30');
  });
});
