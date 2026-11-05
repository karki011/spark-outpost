import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { loadLedger, migrateLedger, saveLedger } from '../src/storage.ts';

const v1 = JSON.stringify([
  { category: ' Food ', amount: '$1,234.50' },
  { category: '', amount: '-$5.00' },
  { amount: '$0.10' },
]);
const v2 = '{"version":2,"entries":[{"category":" Rent","cents":150000}]}';
const migrated = [
  { category: 'food', cents: 123450 },
  { category: 'uncategorized', cents: -500 },
  { category: 'uncategorized', cents: 10 },
];

test('loads version 1 files', () => {
  assert.deepEqual(loadLedger(v1), migrated);
});

test('loads version 2 files and normalises categories', () => {
  assert.deepEqual(loadLedger(v2), [{ category: 'rent', cents: 150000 }]);
});

test('saves version 2 files', () => {
  assert.deepEqual(JSON.parse(saveLedger([{ category: 'food', cents: 5 }])), {
    version: 2,
    entries: [{ category: 'food', cents: 5 }],
  });
});

test('migrates old files and leaves new ones unchanged', () => {
  assert.deepEqual(JSON.parse(migrateLedger(v1)), { version: 2, entries: migrated });
  assert.equal(migrateLedger(v2), v2);
});

test('rejects anything else', () => {
  assert.throws(() => loadLedger('{"version":3,"entries":[]}'));
  assert.throws(() => loadLedger('not json'));
  assert.throws(() => loadLedger('[{"category":"a","amount":"abc"}]'));
  assert.throws(() => migrateLedger('{"version":3,"entries":[]}'));
});

test('ships with tests and a README line', () => {
  assert.ok(existsSync(new URL('../test/storage.test.ts', import.meta.url)));
  assert.match(readFileSync(new URL('../README.md', import.meta.url), 'utf8'), /src\/storage\.ts/);
});
