import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as invoice from '../src/invoice.ts';
import * as totals from '../src/invoice-totals.ts';
import * as text from '../src/text.ts';

const source = (file: string) => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');

const sample: invoice.Invoice = {
  id: 'INV-7',
  customer: 'ada lovelace',
  issued: new Date(Date.UTC(2026, 0, 30)),
  items: [{ description: 'Consulting', cents: 10000, quantity: 3 }],
  discountRate: 0.1,
};

test('invoice.ts still exports everything it exported before', () => {
  for (const name of [
    'roundTo',
    'titleCase',
    'subtotalCents',
    'totalCents',
    'invoiceHeader',
    'dueLabel',
  ]) {
    assert.equal(typeof (invoice as Record<string, unknown>)[name], 'function', name);
  }
  const body = source('invoice.ts');
  for (const name of ['Invoice', 'LineItem']) {
    const named = new RegExp(
      `export\\s+(type\\s+)?\\{[^}]*\\b${name}\\b[^}]*\\}\\s+from\\s+'\\./invoice-totals\\.ts'`,
    );
    const star = /export \* from '\.\/invoice-totals\.ts'/;
    assert.ok(named.test(body) || star.test(body), `${name} is re-exported`);
  }
});

test('the moved code lives in the new modules and is re-exported, not copied', () => {
  assert.equal(invoice.roundTo, text.roundTo);
  assert.equal(invoice.titleCase, text.titleCase);
  assert.equal(invoice.subtotalCents, totals.subtotalCents);
  assert.equal(invoice.totalCents, totals.totalCents);
  assert.doesNotMatch(
    source('invoice.ts'),
    /function (roundTo|titleCase|subtotalCents|totalCents)\b|interface (Invoice|LineItem)\b/,
  );
});

test('behaviour is unchanged', () => {
  assert.equal(invoice.totalCents(sample), 27000);
  assert.equal(invoice.invoiceHeader(sample), 'INV-7 · Ada Lovelace · $270.00');
  assert.equal(text.roundTo(2 / 3, 2), 0.67);
});

test('library modules import from the new modules', () => {
  for (const file of ['ledger.ts', 'report.ts', 'greet.ts']) {
    assert.doesNotMatch(source(file), /from '\.\/invoice\.ts'/, file);
  }
});
