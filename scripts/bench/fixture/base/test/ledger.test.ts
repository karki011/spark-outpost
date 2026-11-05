import assert from 'node:assert/strict';
import test from 'node:test';
import { averageCents, categories, totalFor } from '../src/ledger.ts';
import { categoryShare, reportLine } from '../src/report.ts';

const entries = [
  { category: 'rent', cents: 150000 },
  { category: 'food', cents: 30000 },
  { category: 'food', cents: 20000 },
];

test('summarises entries by category', () => {
  assert.deepEqual(categories(entries), ['food', 'rent']);
  assert.equal(totalFor(entries, 'food'), 50000);
  assert.equal(averageCents(entries), 66666.67);
});

test('reports category shares and lines', () => {
  assert.equal(categoryShare(entries, 'food'), 0.25);
  assert.equal(reportLine(entries, 'food'), 'Food: $500.00');
});
