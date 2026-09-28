import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handle } from '../src/api.ts';
import { migrate } from '../src/db.ts';
import { ORIGINAL_MIGRATIONS, columns, freshDb, legacyDb, migrationText } from './support.ts';

test('a new database has amount_cents and no amount column', () => {
  const cols = columns(freshDb(), 'expenses');
  assert.ok(cols.includes('amount_cents'), `columns: ${cols.join(', ')}`);
  assert.ok(!cols.includes('amount'), `columns: ${cols.join(', ')}`);
});

test('upgrading an existing database keeps every expense', () => {
  const db = legacyDb();
  db.exec("INSERT INTO projects (id, name, budget) VALUES (1, 'Roof', 0), (2, 'Deck', 0)");
  db.exec(`INSERT INTO expenses (id, project_id, amount, note, created_at) VALUES
    (1, 1, 250, 'nails', 1), (2, 1, 100, '', 2), (3, 2, 999, 'boards, oak', 3)`);
  migrate(db);
  const rows = db
    .prepare('SELECT id, project_id, amount_cents, note FROM expenses ORDER BY id')
    .all() as { id: number; project_id: number; amount_cents: number; note: string }[];
  assert.deepEqual(
    rows.map((row) => [row.id, row.project_id, row.amount_cents, row.note]),
    [
      [1, 1, 250, 'nails'],
      [2, 1, 100, ''],
      [3, 2, 999, 'boards, oak'],
    ],
  );
  assert.deepEqual(handle(db, { method: 'GET', path: '/projects/1/total' }).body, { total: 350 });
});

test('the API still adds and totals expenses', () => {
  const db = freshDb();
  handle(db, { method: 'POST', path: '/projects', body: { name: 'Roof' } });
  const added = handle(db, { method: 'POST', path: '/projects/1/expenses', body: { amount: 40 } });
  assert.equal(added.status, 201);
  assert.deepEqual(handle(db, { method: 'GET', path: '/projects/1/total' }).body, { total: 40 });
});

test('the migrations that already ran were not rewritten', () => {
  for (const [name, sql] of Object.entries(ORIGINAL_MIGRATIONS)) {
    assert.equal(migrationText(name).trim(), sql.trim(), `${name} changed`);
  }
});
