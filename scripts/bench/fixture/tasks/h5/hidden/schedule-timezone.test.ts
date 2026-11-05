import assert from 'node:assert/strict';
import test from 'node:test';

process.env.TZ = 'Pacific/Kiritimati';
const dates = (await import('../src/dates.ts')) as Record<string, unknown>;
const scheduleDates = dates.scheduleDates as (
  start: Date,
  count: number,
  everyMonths: number,
) => Date[];

test('works in UTC whatever the machine time zone is', () => {
  assert.equal(new Date('2024-01-31T23:30:00Z').getDate(), 1);
  assert.deepEqual(
    scheduleDates(new Date('2024-01-31T23:30:00Z'), 3, 1).map((value) => value.toISOString()),
    ['2024-01-31T23:30:00.000Z', '2024-02-29T23:30:00.000Z', '2024-03-31T23:30:00.000Z'],
  );
});
