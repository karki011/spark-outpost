import assert from 'node:assert/strict';
import { test } from 'node:test';
import { invoiceTotal } from '../../src/invoice.ts';
import { receiptLine } from '../../src/receipt.ts';
import { refundCents } from '../../src/refund.ts';
import { averageOrder } from '../../src/report.ts';
import { shippingCents } from '../../src/shipping.ts';
import { calcTotal } from '../../src/totals.ts';

const lines = [
  { sku: 'A-100', unitCents: 1200, quantity: 2 },
  { sku: 'B-200', unitCents: 350, quantity: 1 },
];

test('adds every line', () => {
  assert.equal(calcTotal(lines), 2750);
  assert.equal(calcTotal([]), 0);
});

test('feeds the invoice, receipt, report, shipping and refund', () => {
  assert.equal(invoiceTotal(lines, 0.1), 3025);
  assert.equal(receiptLine(lines), 'Total $27.50');
  assert.equal(averageOrder([lines, []]), 1375);
  assert.equal(shippingCents(lines), 499);
  assert.equal(refundCents(lines, ['B-200']), 350);
});
