import { describe, expect, it } from 'vitest';
import { activeLabel, recencyBuckets, recencyLabel } from './recency.ts';

const now = new Date(2026, 8, 26, 15).getTime();
const at = (days: number, hour = 9) => new Date(2026, 8, 26 - days, hour).toISOString();

describe('recencyLabel', () => {
  it('names the recent days by their calendar day, not by 24-hour steps', () => {
    expect(recencyLabel(at(0, 0), now)).toBe('Today');
    expect(recencyLabel(new Date(2026, 8, 25, 23, 59).toISOString(), now)).toBe('Yesterday');
    expect(recencyLabel(at(2), now)).toBe('Previous 7 days');
    expect(recencyLabel(at(7), now)).toBe('Previous 7 days');
    expect(recencyLabel(at(8), now)).toBe('Previous 30 days');
    expect(recencyLabel(at(30), now)).toBe('Previous 30 days');
  });

  it('uses month names after 30 days and adds the year for other years', () => {
    expect(recencyLabel(new Date(2026, 7, 20).toISOString(), now)).toBe('August');
    expect(recencyLabel(new Date(2026, 0, 3).toISOString(), now)).toBe('January');
    expect(recencyLabel(new Date(2025, 11, 30).toISOString(), now)).toBe('December 2025');
  });

  it('treats future and unreadable times as today', () => {
    expect(recencyLabel(at(-2), now)).toBe('Today');
    expect(recencyLabel('not a date', now)).toBe('Today');
  });
});

describe('activeLabel', () => {
  const minutesAgo = (minutes: number) => new Date(now - minutes * 60_000).toISOString();

  it('counts minutes and hours today, then falls back to the sidebar wording', () => {
    expect(activeLabel(minutesAgo(0.5), now)).toBe('Just now');
    expect(activeLabel(minutesAgo(30), now)).toBe('30m ago');
    expect(activeLabel(minutesAgo(125), now)).toBe('2h ago');
    expect(activeLabel(at(0, 0), now)).toBe('15h ago');
    expect(activeLabel(new Date(2026, 8, 25, 23, 59).toISOString(), now)).toBe('Yesterday');
    expect(activeLabel(at(3), now)).toBe('3d ago');
    expect(activeLabel(at(20), now)).toBe('20d ago');
    expect(activeLabel(new Date(2026, 7, 20).toISOString(), now)).toBe('August');
  });
});

describe('recencyBuckets', () => {
  it('sorts newest first and keeps one bucket per label', () => {
    const items = [
      { id: 'august', at: new Date(2026, 7, 2).toISOString() },
      { id: 'today-early', at: at(0, 8) },
      { id: 'yesterday', at: at(1) },
      { id: 'today-late', at: at(0, 14) },
      { id: 'week', at: at(4) },
      { id: 'july', at: new Date(2026, 6, 9).toISOString() },
    ];
    const buckets = recencyBuckets(items, (item) => item.at, now);
    expect(buckets.map((bucket) => [bucket.label, bucket.items.map((item) => item.id)])).toEqual([
      ['Today', ['today-late', 'today-early']],
      ['Yesterday', ['yesterday']],
      ['Previous 7 days', ['week']],
      ['August', ['august']],
      ['July', ['july']],
    ]);
  });

  it('returns no buckets for no items', () => {
    expect(recencyBuckets([], () => '', now)).toEqual([]);
  });
});
