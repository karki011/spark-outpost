import assert from 'node:assert/strict';
import test from 'node:test';
import { invoiceHeader, totalCents, type Invoice } from '../src/invoice.ts';

const invoice: Invoice = {
  id: 'INV-7',
  customer: 'ada lovelace',
  issued: new Date(Date.UTC(2026, 0, 30)),
  items: [
    { description: 'Consulting', cents: 10000, quantity: 3 },
    { description: 'Travel', cents: 2500, quantity: 1 },
  ],
  discountRate: 0.1,
};

test('applies the discount to the total', () => {
  assert.equal(totalCents(invoice), 29250);
});

test('builds a header with the customer and total', () => {
  assert.equal(invoiceHeader(invoice), 'INV-7 · Ada Lovelace · $292.50');
});
