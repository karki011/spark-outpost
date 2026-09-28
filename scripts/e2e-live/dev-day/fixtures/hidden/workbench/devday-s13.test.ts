import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { expensesCsv } from '../src/export.ts';
import { addExpense, createProject } from '../src/projects.ts';
import { freshDb } from './support.ts';

const ROOT = join(import.meta.dirname, '..');

test('exports a project’s expenses as CSV, oldest first', () => {
  const db = freshDb();
  createProject(db, 'Roof');
  createProject(db, 'Deck');
  addExpense(db, 1, 250, 'nails, galvanised', 2_000);
  addExpense(db, 1, 100, 'the "good" tape', 1_000);
  addExpense(db, 2, 5, 'elsewhere', 1_500);
  assert.equal(
    expensesCsv(db, 1),
    'id,created_at,amount,note\n2,1000,100,"the ""good"" tape"\n1,2000,250,"nails, galvanised"\n',
  );
});

test('an empty project is just the header', () => {
  const db = freshDb();
  createProject(db, 'Roof');
  assert.equal(expensesCsv(db, 1), 'id,created_at,amount,note\n');
});

test('the export exists once (no duplicate work after the interruption)', () => {
  const sources = readdirSync(join(ROOT, 'src'), { recursive: true })
    .map(String)
    .filter((file) => file.endsWith('.ts'));
  const definitions = sources.filter((file) =>
    /(function|const|let)\s+expensesCsv\b/.test(readFileSync(join(ROOT, 'src', file), 'utf8')),
  );
  assert.deepEqual(definitions, ['export.ts']);
  const tests = readdirSync(join(ROOT, 'test'))
    .filter((file) => file.endsWith('.test.ts'))
    .filter((file) => readFileSync(join(ROOT, 'test', file), 'utf8').includes('expensesCsv'));
  assert.ok(tests.length <= 1, `expensesCsv is tested in ${tests.join(', ')}`);
});
