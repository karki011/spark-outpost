import { describe, expect, it } from 'vitest';
import { decideDigest, digestSince, refreshableAt } from './policy.ts';

const now = new Date('2026-09-26T15:00:00.000Z');
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
const ready = (minutes: number) => ({ status: 'ready' as const, createdAt: minutesAgo(minutes) });

describe('decideDigest', () => {
  it('starts on open when there is news and the last digest is over an hour old', () => {
    expect(decideDigest('open', null, true, now)).toBe('start');
    expect(decideDigest('open', ready(61), true, now)).toBe('start');
    expect(decideDigest('open', ready(30), true, now)).toBe('fresh');
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
