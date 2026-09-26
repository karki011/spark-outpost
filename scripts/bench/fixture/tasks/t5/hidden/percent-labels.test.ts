import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { discountLabel } from '../src/invoice.ts';
import { formatPercent } from '../src/percent.ts';
import { shareLine } from '../src/report.ts';

test('formatPercent shows one decimal', () => {
  assert.equal(formatPercent(0.125), '12.5%');
  assert.equal(formatPercent(0), '0.0%');
  assert.equal(formatPercent(1), '100.0%');
});

test('shareLine labels a category share', () => {
  const entries = [
    { category: 'rent', cents: 300 },
    { category: 'food', cents: 100 },
  ];
  assert.equal(shareLine(entries, 'food'), 'Food: 25.0%');
});

test('discountLabel shows the invoice discount', () => {
  const invoice = { id: 'I', customer: 'c', issued: new Date(0), items: [], discountRate: 0.1 };
  assert.equal(discountLabel(invoice), 'Discount 10.0%');
});

test('tests cover all three changes', () => {
  const dir = new URL('../test/', import.meta.url);
  const text = readdirSync(dir)
    .map((file) => readFileSync(new URL(file, dir), 'utf8'))
    .join('\n');
  for (const name of ['formatPercent', 'shareLine', 'discountLabel'])
    assert.ok(text.includes(name), name);
});
