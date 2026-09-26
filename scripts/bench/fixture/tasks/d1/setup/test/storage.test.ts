import assert from 'node:assert/strict';
import test from 'node:test';
import { loadLedger, migrateLedger, saveLedger } from '../src/storage.ts';

test('round-trips a ledger', () => {
  const entries = [{ category: 'food', cents: 5 }];
  assert.deepEqual(loadLedger(saveLedger(entries)), entries);
});

test('migrates a version 1 file', () => {
  const v1 = JSON.stringify([{ category: ' Food ', amount: '$1.50' }]);
  assert.equal(migrateLedger(v1), '{"version":2,"entries":[{"category":"food","cents":150}]}');
});
