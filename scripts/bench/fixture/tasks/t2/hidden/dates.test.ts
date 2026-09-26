import assert from 'node:assert/strict';
import test from 'node:test';
import { formatIsoDate } from '../src/dates.ts';
import { dueLabel } from '../src/invoice.ts';

test('formats every month with its calendar number', () => {
  assert.equal(formatIsoDate(new Date(Date.UTC(2026, 0, 1))), '2026-01-01');
  assert.equal(formatIsoDate(new Date(Date.UTC(2026, 8, 26))), '2026-09-26');
  assert.equal(formatIsoDate(new Date(Date.UTC(2026, 11, 5))), '2026-12-05');
});

test('due dates cross month boundaries', () => {
  const invoice = {
    id: 'INV-1',
    customer: 'ada',
    issued: new Date(Date.UTC(2026, 0, 30)),
    items: [],
    discountRate: 0,
  };
  assert.equal(dueLabel(invoice, 30), 'Due 2026-03-01');
});
