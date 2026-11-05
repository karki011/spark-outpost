import assert from 'node:assert/strict';
import test from 'node:test';
import * as dates from '../src/dates.ts';

const scheduleDates = (dates as Record<string, unknown>).scheduleDates as (
  start: Date,
  count: number,
  everyMonths: number,
) => Date[];

const iso = (values: Date[]) => values.map((value) => value.toISOString());

test('exports scheduleDates', () => {
  assert.equal(typeof scheduleDates, 'function');
});

test('returns to the start day after a short month', () => {
  assert.deepEqual(iso(scheduleDates(new Date('2024-01-31T10:30:00Z'), 5, 1)), [
    '2024-01-31T10:30:00.000Z',
    '2024-02-29T10:30:00.000Z',
    '2024-03-31T10:30:00.000Z',
    '2024-04-30T10:30:00.000Z',
    '2024-05-31T10:30:00.000Z',
  ]);
});

test('handles longer steps, leap years and the year boundary', () => {
  assert.deepEqual(iso(scheduleDates(new Date('2023-08-31T00:00:00Z'), 3, 6)), [
    '2023-08-31T00:00:00.000Z',
    '2024-02-29T00:00:00.000Z',
    '2024-08-31T00:00:00.000Z',
  ]);
  assert.deepEqual(iso(scheduleDates(new Date('2024-02-29T08:00:00Z'), 3, 12)), [
    '2024-02-29T08:00:00.000Z',
    '2025-02-28T08:00:00.000Z',
    '2026-02-28T08:00:00.000Z',
  ]);
  assert.deepEqual(iso(scheduleDates(new Date('2024-11-30T12:00:00Z'), 3, 3)), [
    '2024-11-30T12:00:00.000Z',
    '2025-02-28T12:00:00.000Z',
    '2025-05-30T12:00:00.000Z',
  ]);
  assert.deepEqual(iso(scheduleDates(new Date('2024-12-15T00:00:00Z'), 2, 1)), [
    '2024-12-15T00:00:00.000Z',
    '2025-01-15T00:00:00.000Z',
  ]);
});

test('rejects counts and steps that are not whole, and allows an empty schedule', () => {
  const start = new Date('2024-01-01T00:00:00Z');
  assert.deepEqual(scheduleDates(start, 0, 1), []);
  assert.throws(() => scheduleDates(start, -1, 1));
  assert.throws(() => scheduleDates(start, 1.5, 1));
  assert.throws(() => scheduleDates(start, 2, 0));
  assert.throws(() => scheduleDates(start, 2, 0.5));
});
