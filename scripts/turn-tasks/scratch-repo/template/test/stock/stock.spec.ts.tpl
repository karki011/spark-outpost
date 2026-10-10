import assert from 'node:assert/strict';
import { test } from 'node:test';
import { available, canFill } from '../../src/stock.ts';

test('reads the count for a known item', () => {
  assert.equal(available({ 'A-100': 4 }, 'A-100'), 4);
});

test('an item marked as gone has none', () => {
  assert.equal(available({ 'A-100': null }, 'A-100'), 0);
});

test('an item that was never stocked has none', () => {
  assert.equal(available({}, 'Z-999'), 0);
  assert.equal(canFill({}, 'Z-999', 1), false);
});
