import assert from 'node:assert/strict';
import test from 'node:test';
import { formatCents, parseCents } from '../src/money.ts';

test('formats cents as dollars', () => {
  assert.equal(formatCents(123456), '$1234.56');
  assert.equal(formatCents(-50), '-$0.50');
});

test('parses amounts into cents', () => {
  assert.equal(parseCents('$1,234.50'), 123450);
  assert.throws(() => parseCents('abc'));
});
