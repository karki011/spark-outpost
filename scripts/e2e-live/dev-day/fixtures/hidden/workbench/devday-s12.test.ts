import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handle } from '../src/api.ts';
import { addExpense } from '../src/projects.ts';
import { freshDb } from './support.ts';

test('lists a project’s expenses newest first', () => {
  const db = freshDb();
  handle(db, { method: 'POST', path: '/projects', body: { name: 'Roof' } });
  handle(db, { method: 'POST', path: '/projects', body: { name: 'Deck' } });
  addExpense(db, 1, 100, 'first', 1_000);
  addExpense(db, 1, 200, 'second', 3_000);
  addExpense(db, 1, 300, 'same time, later id', 3_000);
  addExpense(db, 2, 400, 'other project', 2_000);
  const response = handle(db, { method: 'GET', path: '/projects/1/expenses' });
  assert.equal(response.status, 200);
  const rows = response.body as {
    id: number;
    projectId: number;
    amount: number;
    note: string;
    createdAt: number;
  }[];
  assert.deepEqual(
    rows.map((row) => [row.id, row.projectId, row.amount, row.note, row.createdAt]),
    [
      [3, 1, 300, 'same time, later id', 3_000],
      [2, 1, 200, 'second', 3_000],
      [1, 1, 100, 'first', 1_000],
    ],
  );
});

test('a missing project is a 404', () => {
  const db = freshDb();
  assert.equal(handle(db, { method: 'GET', path: '/projects/7/expenses' }).status, 404);
});
