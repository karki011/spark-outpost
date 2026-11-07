import { expect, it } from 'vitest';
import { localDay, recapDue, weekStart } from './week.ts';

it('starts the week on Monday at midnight local time', () => {
  expect(localDay(weekStart(new Date(2026, 10, 6, 15, 30)))).toBe('2026-11-02');
  expect(localDay(weekStart(new Date(2026, 10, 2, 0, 0)))).toBe('2026-11-02');
  expect(localDay(weekStart(new Date(2026, 10, 8, 23, 59)))).toBe('2026-11-02');
  expect(weekStart(new Date(2026, 10, 4, 9)).getHours()).toBe(0);
});

it('is due from the chosen day and time until the week ends', () => {
  const friday = 5;
  expect(recapDue(new Date(2026, 10, 6, 14, 59), friday, '15:00')).toBe(false);
  expect(recapDue(new Date(2026, 10, 6, 15, 0), friday, '15:00')).toBe(true);
  expect(recapDue(new Date(2026, 10, 7, 9, 0), friday, '15:00')).toBe(true);
  expect(recapDue(new Date(2026, 10, 8, 23, 0), friday, '15:00')).toBe(true);
  expect(recapDue(new Date(2026, 10, 5, 18, 0), friday, '15:00')).toBe(false);
  expect(recapDue(new Date(2026, 10, 9, 18, 0), friday, '15:00')).toBe(false);
});
