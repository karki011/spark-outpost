import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cartTotal } from '../../src/cart.ts';
import { calcTotal } from '../../src/totals.ts';

const lines = [{ sku: 'A-100', unitCents: 1200, quantity: 3 }];

test('a cart without a discount costs its total', () => {
  assert.equal(cartTotal(lines), calcTotal(lines));
});
