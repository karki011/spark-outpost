import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import * as index from '../src/shop/index.ts';
import * as total from '../src/shop/total.ts';
import { cartSummary } from '../src/shop/cart.ts';
import { amountDue } from '../src/shop/checkout.ts';
import { bulkDiscount } from '../src/shop/discounts.ts';
import { invoiceLines } from '../src/shop/invoice-lines.ts';
import { receiptTotalLine } from '../src/shop/receipt.ts';
import { refundCents } from '../src/shop/refunds.ts';
import { shippingCents } from '../src/shop/shipping.ts';
import { orderSummary } from '../src/shop/summary.ts';
import { salesTax } from '../src/shop/tax.ts';

const lines = [
  { sku: 'lamp', cents: 6000, quantity: 2 },
  { sku: 'bulb', cents: 250, quantity: 4 },
];

test('computeOrderTotal is the new name, with a deprecated alias', () => {
  assert.equal(total.computeOrderTotal(lines), 13000);
  assert.equal(total.calcTotal(lines), 13000);
  assert.equal(index.computeOrderTotal(lines), 13000);
  assert.match(readFileSync('src/shop/total.ts', 'utf8'), /@deprecated/);
});

test('every module behaves as before', () => {
  assert.equal(cartSummary(lines), '2 lines, 13000 cents');
  assert.equal(amountDue(lines, 20000), 0);
  assert.equal(bulkDiscount(lines), 650);
  assert.deepEqual(invoiceLines(lines), ['lamp x2', 'bulb x4', '= 13000']);
  assert.equal(receiptTotalLine(lines), 'TOTAL 130.00');
  assert.equal(refundCents(lines, [lines[1]!]), 1000);
  assert.equal(shippingCents(lines), 0);
  assert.equal(salesTax(lines, 0.1), 1300);
  assert.deepEqual(orderSummary(lines), { subtotal: 13000, tax: 2600, grand: 15600 });
});

test('the old name is gone from the code and the README outside the alias', () => {
  const files = [...readdirSync('src/shop').map((file) => `src/shop/${file}`), 'README.md'];
  for (const file of files) {
    if (file === 'src/shop/total.ts') continue;
    const text = readFileSync(file, 'utf8')
      .split('\n')
      .filter(
        (line) => !(file === 'src/shop/index.ts' && /^export .* from '\.\/total\.ts'/.test(line)),
      )
      .filter((line) => !(file === 'README.md' && /deprecated/i.test(line)))
      .join('\n');
    assert.doesNotMatch(text, /\bcalcTotal\b/, file);
  }
});
