import { describe, expect, it } from 'vitest';
import { decideDigest, digestSince, morningDue, refreshableAt } from './policy.ts';

const now = new Date('2026-09-26T15:00:00.000Z');
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
const ready = (minutes: number) => ({ status: 'ready' as const, createdAt: minutesAgo(minutes) });

describe('decideDigest', () => {
  it('starts on open when there is news and the last digest is over half an hour old', () => {
    expect(decideDigest('open', null, true, now)).toBe('start');
    expect(decideDigest('open', ready(31), true, now)).toBe('start');
    expect(decideDigest('open', ready(20), true, now)).toBe('fresh');
  });

  it('follows the chosen interval, or only runs on Refresh when set to manual', () => {
    expect(decideDigest('open', ready(20), true, now, 15 * 60_000)).toBe('start');
    expect(decideDigest('open', ready(45), true, now, 60 * 60_000)).toBe('fresh');
    expect(decideDigest('open', null, true, now, null)).toBe('fresh');
    expect(decideDigest('refresh', ready(45), true, now, null)).toBe('start');
  });

  it('never runs more than once in ten minutes, even on refresh', () => {
    expect(decideDigest('refresh', ready(5), true, now)).toBe('throttled');
    expect(decideDigest('refresh', ready(11), true, now)).toBe('start');
  });

  it('stays quiet without new activity and waits for a running digest', () => {
    expect(decideDigest('refresh', ready(90), false, now)).toBe('quiet');
    expect(decideDigest('open', { status: 'running', createdAt: minutesAgo(1) }, true, now)).toBe(
      'running',
    );
  });

  it('does not retry a failed digest on open within the hour', () => {
    expect(decideDigest('open', { status: 'failed', createdAt: minutesAgo(20) }, true, now)).toBe(
      'fresh',
    );
    expect(
      decideDigest('refresh', { status: 'failed', createdAt: minutesAgo(20) }, true, now),
    ).toBe('start');
  });
});

describe('morning brief', () => {
  const at = (hour: number, minute = 0) => {
    const date = new Date(now);
    date.setHours(hour, minute, 0, 0);
    return date;
  };
  const readyAt = (date: Date) => ({ status: 'ready' as const, createdAt: date });

  it('is due once after seven, when no brief was written since then', () => {
    expect(morningDue(null, at(6, 59))).toBe(false);
    expect(morningDue(null, at(7, 5))).toBe(true);
    expect(morningDue(readyAt(at(6, 30)), at(8))).toBe(true);
    expect(morningDue(readyAt(at(7, 30)), at(8))).toBe(false);
  });

  it('is due after the time you saved instead', () => {
    expect(morningDue(null, at(6, 29), '06:30')).toBe(false);
    expect(morningDue(null, at(6, 30), '06:30')).toBe(true);
    expect(morningDue(readyAt(at(6, 45)), at(9, 30), '09:15')).toBe(true);
    expect(morningDue(readyAt(at(9, 20)), at(9, 30), '09:15')).toBe(false);
    expect(decideDigest('morning', null, true, at(8), null, '09:00')).toBe('fresh');
    expect(decideDigest('morning', null, true, at(9, 1), null, '09:00')).toBe('start');
  });

  it('starts a morning brief only when something changed', () => {
    const last = readyAt(new Date(at(7).getTime() - 12 * 3_600_000));
    expect(decideDigest('morning', last, true, at(8))).toBe('start');
    expect(decideDigest('morning', last, false, at(8))).toBe('quiet');
    expect(decideDigest('morning', readyAt(at(7, 30)), true, at(9))).toBe('fresh');
  });
});

describe('digest window', () => {
  it('covers the time since the last digest, or the last day, and at most a week', () => {
    expect(digestSince(minutesAgo(90), now)).toEqual(minutesAgo(90));
    expect(digestSince(null, now)).toEqual(minutesAgo(24 * 60));
    expect(digestSince(minutesAgo(10 * 24 * 60), now)).toEqual(minutesAgo(7 * 24 * 60));
  });

  it('allows the next refresh ten minutes after the last digest', () => {
    expect(refreshableAt(ready(4))).toEqual(new Date(minutesAgo(4).getTime() + 10 * 60_000));
    expect(refreshableAt(null)).toBeNull();
  });
});
