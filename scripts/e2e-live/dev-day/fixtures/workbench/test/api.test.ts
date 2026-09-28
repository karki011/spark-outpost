import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handle } from '../src/api.ts';
import { freshDb } from './support.ts';

test('creates and lists projects', () => {
  const db = freshDb();
  assert.equal(
    handle(db, { method: 'POST', path: '/projects', body: { name: 'Roof' } }).status,
    201,
  );
  const list = handle(db, { method: 'GET', path: '/projects' });
  assert.deepEqual(
    (list.body as { name: string }[]).map((project) => project.name),
    ['Roof'],
  );
});

test('totals expenses', () => {
  const db = freshDb();
  handle(db, { method: 'POST', path: '/projects', body: { name: 'Roof' } });
  handle(db, {
    method: 'POST',
    path: '/projects/1/expenses',
    body: { amount: 250, note: 'nails' },
  });
  handle(db, { method: 'POST', path: '/projects/1/expenses', body: { amount: 100 } });
  assert.deepEqual(handle(db, { method: 'GET', path: '/projects/1/total' }).body, { total: 350 });
});

test('rejects a bad amount', () => {
  const db = freshDb();
  handle(db, { method: 'POST', path: '/projects', body: { name: 'Roof' } });
  const response = handle(db, {
    method: 'POST',
    path: '/projects/1/expenses',
    body: { amount: -3 },
  });
  assert.equal(response.status, 400);
});
