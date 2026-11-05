import assert from 'node:assert/strict';
import test from 'node:test';
import { formatIsoDate } from '../src/dates.ts';

test('formats the last day of January', () => {
  assert.equal(formatIsoDate(new Date(Date.UTC(2026, 0, 31))), '2026-01-31');
});
