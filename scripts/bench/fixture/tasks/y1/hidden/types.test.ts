import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { creditNoteCents } from '../src/credit-note.ts';
import { subtotalCents, totalCents, type Invoice } from '../src/invoice.ts';

const invoice = {
  id: 'INV-1',
  customer: 'ada',
  issued: new Date(Date.UTC(2026, 0, 1)),
  items: [
    { description: 'A', unitCents: 1000, quantity: 3 },
    { description: 'B', unitCents: 250, quantity: 2 },
  ],
  discountRate: 0.5,
} as unknown as Invoice;

test('the type checker passes', () => {
  const tsc = spawnSync(
    process.execPath,
    ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json'],
    {
      encoding: 'utf8',
    },
  );
  assert.equal(tsc.status, 0, tsc.stdout);
});

test('line items use unitCents and totals keep their behaviour', () => {
  assert.equal(subtotalCents(invoice), 3500);
  assert.equal(totalCents(invoice), 1750);
  assert.equal(creditNoteCents(invoice, [{ description: 'A', quantity: 2 }]), -1000);
});

test('ledger entries keep their cents field', () => {
  const ledger = readFileSync('src/ledger.ts', 'utf8');
  assert.match(ledger, /interface Entry \{[^}]*\bcents: number/);
});

test('the checker is not silenced', () => {
  const files = [
    ...readdirSync('src').map((file) => `src/${file}`),
    ...readdirSync('test').map((file) => `test/${file}`),
  ];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /@ts-ignore|@ts-expect-error|@ts-nocheck|\bas any\b|: any\b/, file);
  }
  assert.doesNotMatch(readFileSync('tsconfig.json', 'utf8'), /"strict":\s*false|"noCheck"/);
});
