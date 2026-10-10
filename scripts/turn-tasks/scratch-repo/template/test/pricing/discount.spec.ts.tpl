import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyDiscount } from '../../src/discount.ts';

test('no discount leaves the amount alone', () => {
  assert.equal(applyDiscount(2000, 0), 2000);
});

test('a full discount is free', () => {
  assert.equal(applyDiscount(2000, 100), 0);
});

test('ten percent off twenty dollars is eighteen dollars', () => {
  assert.equal(applyDiscount(2000, 10), 1800);
});
