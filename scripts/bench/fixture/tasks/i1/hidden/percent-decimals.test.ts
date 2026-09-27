import assert from 'node:assert/strict';
import test from 'node:test';
import { percentOf } from '../src/money.ts';

test('percentOf keeps one decimal by default', () => {
  assert.equal(percentOf(1, 3), 33.3);
  assert.equal(percentOf(2, 3), 66.7);
  assert.equal(percentOf(5, 0), 0);
});

test('percentOf takes the number of decimals', () => {
  assert.equal(percentOf(1, 3, 2), 33.33);
  assert.equal(percentOf(2, 3, 0), 67);
  assert.equal(percentOf(1, 8, 3), 12.5);
  assert.equal(percentOf(5, 0, 2), 0);
});
