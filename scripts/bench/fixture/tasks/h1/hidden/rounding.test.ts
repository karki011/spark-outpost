import assert from 'node:assert/strict';
import test from 'node:test';
import { roundTo, totalCents, type Invoice } from '../src/invoice.ts';
import { parseCents } from '../src/money.ts';

const invoice = (cents: number, discountRate: number): Invoice => ({
  id: 'INV-1',
  customer: 'c',
  issued: new Date(0),
  items: [{ description: 'x', cents, quantity: 1 }],
  discountRate,
});

test('roundTo rounds half away from zero, including float edge cases', () => {
  assert.equal(roundTo(1.005, 2), 1.01);
  assert.equal(roundTo(1.2345, 3), 1.235);
  assert.equal(roundTo(2.5, 0), 3);
  assert.equal(roundTo(-2.5, 0), -3);
  assert.equal(roundTo(-1.005, 2), -1.01);
  assert.equal(roundTo(66666.666666, 2), 66666.67);
});

test('parseCents rounds half-cents away from zero', () => {
  assert.equal(parseCents('1.005'), 101);
  assert.equal(parseCents('$0.125'), 13);
  assert.equal(parseCents('-0.125'), -13);
  assert.equal(parseCents('-$1,234.505'), -123451);
});

test('refund totals mirror the matching charges', () => {
  assert.equal(totalCents(invoice(1001, 0.5)), 501);
  assert.equal(totalCents(invoice(-1001, 0.5)), -501);
  assert.equal(totalCents(invoice(105, 0.1)), 95);
  assert.equal(totalCents(invoice(-105, 0.1)), -95);
});
