import assert from 'node:assert/strict';
import test from 'node:test';
import { clampCents } from '../src/money.ts';

test('clampCents keeps values inside the range', () => {
  assert.equal(clampCents(500, 0, 1000), 500);
  assert.equal(clampCents(-20, 0, 1000), 0);
  assert.equal(clampCents(1500, 0, 1000), 1000);
  assert.equal(clampCents(-300, -200, -100), -200);
});

test('clampCents rejects an empty range and fractional cents', () => {
  assert.throws(() => clampCents(5, 10, 0));
  assert.throws(() => clampCents(1.5, 0, 10));
});
