import { describe, expect, it } from 'vitest';
import {
  extraUsageText,
  resetPhrase,
  resetTimeText,
  shownPercent,
  windowDetail,
  type ExtraUsage,
} from './plan-limits.ts';

const now = new Date(2026, 9, 16, 13, 5);
const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute);
const weekday = (date: Date) => date.toLocaleDateString([], { weekday: 'short' });
const clock = (date: Date) =>
  date
    .toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    .replace(/\b([AP])\.?M\.?$/i, (_match, half: string) => `${half.toLowerCase()}m`);

describe('plan reset times', () => {
  it('names only the time for a reset later today', () => {
    expect(resetTimeText(at(16, 15, 40), now)).toBe(clock(at(16, 15, 40)));
    expect(resetTimeText(at(16, 15, 40), now)).toMatch(/pm$/);
  });

  it('names the day and time for a reset within a day', () => {
    const reset = at(17, 1, 30);
    expect(resetTimeText(reset, now)).toBe(`${weekday(reset)} ${clock(reset)}`);
  });

  it('names only the day for a reset further out', () => {
    expect(resetTimeText(at(19, 9), now)).toBe(weekday(at(19, 9)));
  });

  it('writes the phrase for the limit message', () => {
    expect(resetPhrase(at(16, 15, 40), now)).toBe(`at ${clock(at(16, 15, 40))}`);
    expect(resetPhrase(at(19, 9), now)).toMatch(/^on \w+ at /);
  });
});

describe('plan window text', () => {
  it('rounds and caps the shown percentage', () => {
    expect(shownPercent(41.6)).toBe(42);
    expect(shownPercent(102)).toBe(100);
  });

  it('describes a window in one line', () => {
    const window = {
      window: 'five_hour' as const,
      usedPercent: 42,
      resetsAt: at(16, 15, 40).toISOString(),
      limited: false,
      observedAt: now.toISOString(),
    };
    expect(windowDetail(window, now)).toBe(`42% · resets ${clock(at(16, 15, 40))}`);
  });
});

describe('extra usage text', () => {
  const extra = (fields: Partial<ExtraUsage>): ExtraUsage => ({
    status: 'allowed',
    inUse: false,
    disabledReason: null,
    resetsAt: null,
    observedAt: now.toISOString(),
    ...fields,
  });

  it('says it is in use, with its reset', () => {
    const resetsAt = at(19, 9).toISOString();
    expect(extraUsageText(extra({ inUse: true, resetsAt }), now)).toBe(
      `in use · resets ${weekday(at(19, 9))}`,
    );
  });

  it('says it is on when allowed and not in use', () => {
    expect(extraUsageText(extra({}), now)).toBe('on');
  });

  it('names a known reason it is not available', () => {
    const off = extra({ status: 'rejected', disabledReason: 'out_of_credits' });
    expect(extraUsageText(off, now)).toBe('not available · out of credits');
  });

  it('says only not available for an unknown reason', () => {
    const off = extra({ status: 'rejected', disabledReason: 'something_new' });
    expect(extraUsageText(off, now)).toBe('not available');
  });
});
