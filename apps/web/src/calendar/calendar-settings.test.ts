import { describe, expect, it } from 'vitest';
import { searchSettings } from '../settings/settings-search.ts';
import { CALENDAR_BRIEF_LABEL, CALENDAR_NOTIFY_ROWS } from './CalendarNotifySettings.tsx';
import { parseFocusNames } from './focus-names.ts';

const notifications = (rows: readonly string[]) => [
  { id: 'notifications', label: 'Notifications', groupLabel: 'Mac', rows },
];

describe('calendar rows in Settings search', () => {
  const rows = ['Morning brief', CALENDAR_BRIEF_LABEL, ...CALENDAR_NOTIFY_ROWS];

  it('lands on each calendar control by its own words', () => {
    const found = (query: string) =>
      searchSettings(query, notifications(rows)).map((match) => match.row);
    expect(found('hold chimes')).toEqual(['Hold chimes during']);
    expect(found('wrap')).toEqual(['Wrap-up reminder']);
    expect(found('capture')).toEqual(['Anything to capture?']);
    expect(found('focus blocks')).toEqual(['Focus blocks are events named']);
    expect(found('paired')).toEqual(['Meeting alerts on paired devices']);
    expect(found('calendar brief')).toEqual(['Add today’s calendar to the brief']);
    expect(found('before a meeting')).toEqual(['Before a meeting']);
  });
});

describe('parseFocusNames', () => {
  it('trims, drops blanks and repeats that differ only in case', () => {
    expect(parseFocusNames(' Focus, Deep work ,, focus,Heads down')).toEqual({
      ok: true,
      names: ['Focus', 'Deep work', 'Heads down'],
    });
  });

  it('refuses an empty list, too many names and a long name', () => {
    expect(parseFocusNames(' , ').ok).toBe(false);
    expect(parseFocusNames(Array.from({ length: 13 }, (_, i) => `n${i}`).join(',')).ok).toBe(false);
    expect(parseFocusNames('x'.repeat(61)).ok).toBe(false);
  });
});
