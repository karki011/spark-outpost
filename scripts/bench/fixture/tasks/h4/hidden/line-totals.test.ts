import assert from 'node:assert/strict';
import test from 'node:test';
import * as invoices from '../src/invoice.ts';
import type { Invoice } from '../src/invoice.ts';

const { invoiceHeader, totalCents } = invoices;
const lineTotalsCents = (invoices as Record<string, unknown>).lineTotalsCents as (
  invoice: Invoice,
) => number[];

function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

const RATES = [0, 0.1, 0.125, 0.07, 1 / 3, 0.5, 0.155];

function invoiceFrom(next: () => number): Invoice {
  const count = 1 + Math.floor(next() * 7);
  return {
    id: 'INV-R',
    customer: 'ada',
    issued: new Date(Date.UTC(2026, 0, 1)),
    discountRate: RATES[Math.floor(next() * RATES.length)]!,
    items: Array.from({ length: count }, () => ({
      description: 'item',
      cents: Math.floor(next() * 25_000) - 5_000,
      quantity: Math.floor(next() * 6),
    })),
  };
}

function check(invoice: Invoice): void {
  const lines = lineTotalsCents(invoice);
  assert.equal(lines.length, invoice.items.length);
  assert.ok(lines.every(Number.isInteger), 'every line is whole cents');
  assert.equal(
    lines.reduce((sum, line) => sum + line, 0),
    totalCents(invoice),
    'the lines add up to the header total',
  );
  invoice.items.forEach((item, index) => {
    const exact = item.cents * item.quantity * (1 - invoice.discountRate);
    assert.ok(Math.abs(lines[index]! - exact) <= 1, `line ${index} is within a cent of ${exact}`);
  });
}

test('exports lineTotalsCents', () => {
  assert.equal(typeof lineTotalsCents, 'function');
});

test('lines always add up to the total, each within one cent', () => {
  const next = random(20260926);
  for (let round = 0; round < 400; round += 1) check(invoiceFrom(next));
});

test('many small lines that all round the same way still add up', () => {
  const invoice: Invoice = {
    id: 'INV-S',
    customer: 'ada',
    issued: new Date(0),
    discountRate: 0.1,
    items: Array.from({ length: 9 }, () => ({ description: 'pen', cents: 5, quantity: 1 })),
  };
  check(invoice);
});

test('credits and a discount that lands on half cents', () => {
  check({
    id: 'INV-C',
    customer: 'ada',
    issued: new Date(0),
    discountRate: 0.5,
    items: [
      { description: 'refund', cents: -333, quantity: 1 },
      { description: 'fee', cents: 101, quantity: 3 },
      { description: 'refund', cents: -1, quantity: 5 },
      { description: 'free', cents: 999, quantity: 0 },
    ],
  });
});

test('keeps the header and total unchanged', () => {
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
  assert.equal(totalCents(invoice), 29250);
  assert.equal(invoiceHeader(invoice), 'INV-7 · Ada Lovelace · $292.50');
  assert.deepEqual(lineTotalsCents(invoice), [27000, 2250]);
});
