import assert from 'node:assert/strict';
import test from 'node:test';
import { creditNoteCents, creditNoteLine } from '../src/credit-note.ts';
import type { Invoice } from '../src/invoice.ts';

const invoice: Invoice = {
  id: 'INV-9',
  customer: 'grace hopper',
  issued: new Date(Date.UTC(2026, 1, 2)),
  items: [
    { description: 'Keyboard', cents: 4500, quantity: 2 },
    { description: 'Cable', cents: 900, quantity: 3 },
  ],
  discountRate: 0.2,
};

test('credits returned items after the discount', () => {
  assert.equal(creditNoteCents(invoice, [{ description: 'Keyboard', quantity: 1 }]), -3600);
  assert.equal(
    creditNoteLine(invoice, [{ description: 'Cable', quantity: 2 }]),
    'Credit for INV-9: -$14.40',
  );
});

test('refuses to credit more than was sold', () => {
  assert.throws(() => creditNoteCents(invoice, [{ description: 'Cable', quantity: 4 }]));
});
