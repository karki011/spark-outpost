import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import * as ledger from '../src/ledger.ts';
import { loadLedger } from '../src/storage.ts';

const cleanup = (await import('../src/cleanup.ts')) as {
  cleanLedger: (text: string) => { text: string; removed: number };
};

const v2 = (entries: { category: string; cents: number }[]) =>
  JSON.stringify({ version: 2, entries });

test('deletes zero entries and repeated entries, keeping the first in order', () => {
  const result = cleanup.cleanLedger(
    v2([
      { category: 'rent', cents: 150000 },
      { category: ' Food ', cents: 1250 },
      { category: 'misc', cents: 0 },
      { category: 'food', cents: 1250 },
      { category: 'food', cents: 1300 },
      { category: 'RENT', cents: 150000 },
      { category: 'misc', cents: -0 },
      { category: 'refund', cents: -500 },
      { category: 'refund', cents: -500 },
    ]),
  );
  assert.equal(result.removed, 5);
  assert.deepEqual(JSON.parse(result.text), {
    version: 2,
    entries: [
      { category: 'rent', cents: 150000 },
      { category: 'food', cents: 1250 },
      { category: 'food', cents: 1300 },
      { category: 'refund', cents: -500 },
    ],
  });
});

test('cleans version 1 files and writes version 2', () => {
  const v1 = JSON.stringify([
    { category: '', amount: '$1.00' },
    { amount: '$1.00' },
    { category: 'x', amount: '$0.00' },
    { category: 'x', amount: '-$0.00' },
  ]);
  const result = cleanup.cleanLedger(v1);
  assert.equal(result.removed, 3);
  assert.deepEqual(loadLedger(result.text), [{ category: 'uncategorized', cents: 100 }]);
  assert.equal(JSON.parse(result.text).version, 2);
});

test('an already clean file loses nothing', () => {
  const text = v2([{ category: 'a', cents: 1 }]);
  assert.deepEqual(cleanup.cleanLedger(text), { text, removed: 0 });
});

test('throws on a file loadLedger rejects instead of deleting anything', () => {
  assert.throws(() => cleanup.cleanLedger('{"version":3,"entries":[]}'));
  assert.throws(() => cleanup.cleanLedger('not json'));
});

test('removes averageCents and keeps the rest of the ledger module', () => {
  assert.equal('averageCents' in ledger, false);
  assert.equal(typeof ledger.categories, 'function');
  assert.equal(typeof ledger.totalFor, 'function');
  assert.ok(existsSync(new URL('../test/cleanup.test.ts', import.meta.url)));
});
