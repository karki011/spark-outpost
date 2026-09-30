import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handle } from '../src/api.ts';
import { renderProjectPage } from '../src/ui.ts';
import { freshDb } from './support.ts';

test('a project budget can be set and read', () => {
  const db = freshDb();
  handle(db, { method: 'POST', path: '/projects', body: { name: 'Roof' } });
  assert.equal(
    handle(db, { method: 'PUT', path: '/projects/1/budget', body: { amount: 5 } }).status,
    200,
  );
  assert.deepEqual(handle(db, { method: 'GET', path: '/projects/1/budget' }).body, {
    projectId: 1,
    amount: 5,
    spent: 0,
  });
  assert.equal(
    handle(db, { method: 'PUT', path: '/projects/1/budget', body: { amount: 0 } }).status,
    400,
  );
  assert.equal(handle(db, { method: 'GET', path: '/projects/2/budget' }).status, 404);
});

test('the budget bar fills to the share spent', () => {
  assert.match(renderProjectPage({ id: 1, name: 'Roof' }, 50, 200), /aria-valuenow="25"/);
});
