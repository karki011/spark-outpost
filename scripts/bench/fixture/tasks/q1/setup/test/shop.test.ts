import assert from 'node:assert/strict';
import test from 'node:test';
import { amountDue, calcTotal, cartSummary, orderSummary } from '../src/shop/index.ts';

const lines = [
  { sku: 'pen', cents: 150, quantity: 4 },
  { sku: 'pad', cents: 1200, quantity: 1 },
];

test('calcTotal adds up the order', () => {
  assert.equal(calcTotal(lines), 1800);
  assert.equal(cartSummary(lines), '2 lines, 1800 cents');
  assert.equal(amountDue(lines, 500), 1300);
  assert.deepEqual(orderSummary(lines), { subtotal: 1800, tax: 360, grand: 2160 });
});
