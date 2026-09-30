import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyticsRows, renderAnalytics } from '../src/analytics.ts';
import { projectsCsv } from '../src/export.ts';
import { addExpense, createProject } from '../src/projects.ts';
import { freshDb } from './support.ts';

function seeded() {
  const db = freshDb();
  createProject(db, 'Roof');
  createProject(db, 'Deck, north');
  addExpense(db, 1, 300);
  addExpense(db, 2, 500);
  return db;
}

test('analytics lists projects by spend', () => {
  const rows = analyticsRows(seeded());
  assert.deepEqual(
    rows.map((row) => [row.name, row.spent]),
    [
      ['Deck, north', 500],
      ['Roof', 300],
    ],
  );
  assert.match(renderAnalytics(rows), /<td class="spent">500<\/td>/);
});

test('the CSV export lists every project by id', () => {
  assert.equal(projectsCsv(seeded()), 'id,name,spent\n1,Roof,300\n2,"Deck, north",500\n');
});
