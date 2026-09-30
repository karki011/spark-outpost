import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type { DatabaseSync } from 'node:sqlite';
import { analyticsRows, renderAnalytics } from '../src/analytics.ts';
import { handle } from '../src/api.ts';
import { MIGRATIONS_DIR, migrate, openDb } from '../src/db.ts';
import { projectsCsv } from '../src/export.ts';
import { renderProjectPage } from '../src/ui.ts';

const ORIGINAL = ['001_projects.sql', '002_expenses.sql'];

function freshDb(): DatabaseSync {
  const db = openDb();
  migrate(db);
  return db;
}

function legacyDb(): DatabaseSync {
  const db = openDb();
  db.exec('CREATE TABLE schema_migrations (name TEXT PRIMARY KEY)');
  for (const name of ORIGINAL) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, name), 'utf8'));
    db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(name);
  }
  return db;
}

function seeded(): DatabaseSync {
  const db = freshDb();
  for (const name of ['Roof', 'Deck', 'Shed']) {
    handle(db, { method: 'POST', path: '/projects', body: { name } });
  }
  handle(db, { method: 'POST', path: '/projects/1/expenses', body: { amount: 300 } });
  handle(db, { method: 'POST', path: '/projects/1/expenses', body: { amount: 200 } });
  handle(db, { method: 'POST', path: '/projects/2/expenses', body: { amount: 100 } });
  return db;
}

const put = (db: DatabaseSync, id: number, body: unknown) =>
  handle(db, { method: 'PUT', path: `/projects/${id}/budget`, body });
const get = (db: DatabaseSync, id: number) =>
  handle(db, { method: 'GET', path: `/projects/${id}/budget` });

test('a new migration adds project_budgets and leaves the old ones alone', () => {
  const names = readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith('.sql'));
  assert.ok(names.length > ORIGINAL.length, 'a new migration file');
  assert.deepEqual(names.slice(0, 2), ORIGINAL);
  const db = freshDb();
  const columns = (db.prepare('PRAGMA table_info(project_budgets)').all() as { name: string }[])
    .map((row) => row.name)
    .sort();
  assert.deepEqual(columns, ['amount', 'project_id']);
  const keys = db.prepare('PRAGMA foreign_key_list(project_budgets)').all() as {
    table: string;
  }[];
  assert.ok(
    keys.some((key) => key.table === 'projects'),
    'project_id references projects',
  );
});

test('an existing database upgrades in place and its projects have no budget', () => {
  const db = legacyDb();
  db.exec("INSERT INTO projects (id, name) VALUES (1, 'Old')");
  migrate(db);
  const response = get(db, 1);
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { projectId: 1, amount: null, spent: 0 });
});

interface Budgets {
  getBudget(db: DatabaseSync, projectId: number): number | null;
  setBudget(db: DatabaseSync, projectId: number, amount: number): void;
}

test('the repository stores one budget per project and a new one replaces it', async () => {
  const budgets = (await import('../src/budgets.ts')) as Budgets;
  const db = seeded();
  assert.equal(budgets.getBudget(db, 1), null);
  budgets.setBudget(db, 1, 400);
  assert.equal(budgets.getBudget(db, 1), 400);
  budgets.setBudget(db, 1, 900);
  assert.equal(budgets.getBudget(db, 1), 900);
  assert.equal(budgets.getBudget(db, 2), null);
});

test('PUT then GET a budget answers amount and spent', () => {
  const db = seeded();
  const saved = put(db, 1, { amount: 400 });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body, { projectId: 1, amount: 400, spent: 500 });
  put(db, 1, { amount: 1000 });
  assert.deepEqual(get(db, 1).body, { projectId: 1, amount: 1000, spent: 500 });
  assert.deepEqual(get(db, 3).body, { projectId: 3, amount: null, spent: 0 });
});

test('a budget that is not a positive whole number is a 400 and changes nothing', () => {
  const db = seeded();
  put(db, 1, { amount: 400 });
  for (const body of [{ amount: 0 }, { amount: -5 }, { amount: 2.5 }, { amount: '100' }, {}]) {
    assert.equal(put(db, 1, body).status, 400, JSON.stringify(body));
  }
  assert.equal((get(db, 1).body as { amount: number }).amount, 400);
});

test('an unknown project is a 404 for GET and PUT', () => {
  const db = seeded();
  assert.equal(get(db, 99).status, 404);
  assert.equal(put(db, 99, { amount: 10 }).status, 404);
});

test('the project page shows a budget bar, or says there is no budget', () => {
  const page = renderProjectPage({ id: 1, name: 'Roof' }, 250, 1000);
  assert.match(page, /class="budget-bar"/);
  assert.match(page, /role="progressbar"/);
  assert.match(page, /aria-valuenow="25"/);
  assert.doesNotMatch(page, /budget-bar[^"]*\bover\b/);
  const none = renderProjectPage({ id: 1, name: 'Roof' }, 250, null);
  assert.doesNotMatch(none, /budget-bar/);
  assert.match(none, /<p class="no-budget">No budget set<\/p>/);
});

test('an over-budget bar is marked over and capped at 100', () => {
  const page = renderProjectPage({ id: 1, name: 'Roof' }, 500, 400);
  assert.match(page, /class="budget-bar over"|class="over budget-bar"/);
  assert.match(page, /aria-valuenow="100"/);
});

test('analytics badges only the over-budget projects', () => {
  const db = seeded();
  put(db, 1, { amount: 400 });
  put(db, 2, { amount: 1000 });
  const rows = analyticsRows(db);
  const byName = new Map(rows.map((row) => [row.name, row]));
  assert.equal(byName.get('Roof')?.budget, 400);
  assert.equal(byName.get('Roof')?.overBudget, true);
  assert.equal(byName.get('Deck')?.overBudget, false);
  assert.equal(byName.get('Shed')?.budget, null);
  assert.equal(byName.get('Shed')?.overBudget, false);
  const html = renderAnalytics(rows);
  const badges = html.match(/<span class="badge over-budget">Over budget<\/span>/g) ?? [];
  assert.equal(badges.length, 1);
  const roofRow = /<tr data-id="1">.*?<\/tr>/.exec(html)?.[0] ?? '';
  assert.match(roofRow, /Over budget/);
});

test('the CSV export has a budget column after spent, empty when unset', () => {
  const db = seeded();
  put(db, 1, { amount: 400 });
  assert.equal(projectsCsv(db), 'id,name,spent,budget\n1,Roof,500,400\n2,Deck,100,\n3,Shed,0,\n');
});
