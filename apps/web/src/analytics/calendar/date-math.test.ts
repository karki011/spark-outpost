import { describe, expect, it } from 'vitest';
import {
  CALENDAR_PRESETS,
  addIsoDays,
  formatIsoLocal,
  formatRangeLabel,
  isCappedOut,
  isFutureIso,
  isoSpanDays,
  parseIsoLocal,
} from './date-math.ts';

describe('date math', () => {
  it('adds and spans iso days across a month boundary', () => {
    expect(addIsoDays('2026-09-27', -6)).toBe('2026-09-21');
    expect(addIsoDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(isoSpanDays('2026-09-21', '2026-09-27')).toBe(7);
  });

  it('round-trips local date parsing regardless of the runtime time zone', () => {
    const date = parseIsoLocal('2026-09-27');
    expect(formatIsoLocal(date)).toBe('2026-09-27');
  });

  it('flags future dates and caps the span at 366 days', () => {
    expect(isFutureIso('2026-09-28', '2026-09-27')).toBe(true);
    expect(isFutureIso('2026-09-27', '2026-09-27')).toBe(false);
    expect(isCappedOut('2026-09-27', '2027-09-28')).toBe(true);
    expect(isCappedOut('2026-09-27', '2027-09-27')).toBe(false);
    expect(isCappedOut(undefined, '2027-09-27')).toBe(false);
  });

  it('computes the five quick presets relative to today', () => {
    const today = '2026-09-27';
    const byId = Object.fromEntries(
      CALENDAR_PRESETS.map((preset) => [preset.id, preset.range(today)]),
    );
    expect(byId.last7).toEqual({ from: '2026-09-21', to: today });
    expect(byId.last30).toEqual({ from: '2026-08-29', to: today });
    expect(byId.last90).toEqual({ from: '2026-06-30', to: today });
    expect(byId.thisMonth).toEqual({ from: '2026-09-01', to: today });
    expect(byId.lastMonth).toEqual({ from: '2026-08-01', to: '2026-08-31' });
  });

  it('formats a human range label', () => {
    expect(formatRangeLabel('2026-09-01', '2026-09-27')).toBe('Sep 1 – Sep 27, 2026');
    expect(formatRangeLabel('2025-12-01', '2026-01-05')).toBe('Dec 1, 2025 – Jan 5, 2026');
  });
});
