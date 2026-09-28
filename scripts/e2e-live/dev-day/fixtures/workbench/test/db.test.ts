import assert from 'node:assert/strict';
import { test } from 'node:test';
import { migrate, openDb } from '../src/db.ts';

test('migrations run once', () => {
  const db = openDb();
  assert.ok(migrate(db).length >= 2);
  assert.deepEqual(migrate(db), []);
});
