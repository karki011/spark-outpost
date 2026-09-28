import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handle } from '../src/api.ts';
import { migrate } from '../src/db.ts';
import { renderProjectList } from '../src/ui.ts';
import { freshDb, legacyDb } from './support.ts';

function withProject() {
  const db = freshDb();
  handle(db, { method: 'POST', path: '/projects', body: { name: 'Roof' } });
  return db;
}

test('PUT tags normalises and returns them', () => {
  const db = withProject();
  const put = handle(db, {
    method: 'PUT',
    path: '/projects/1/tags',
    body: { tags: [' Urgent ', 'urgent', 'Outdoor'] },
  });
  assert.equal(put.status, 200);
  assert.deepEqual(put.body, { tags: ['outdoor', 'urgent'] });
});

test('projects carry their tags, untagged ones an empty list', () => {
  const db = withProject();
  handle(db, { method: 'POST', path: '/projects', body: { name: 'Deck' } });
  handle(db, { method: 'PUT', path: '/projects/1/tags', body: { tags: ['b', 'a'] } });
  const list = handle(db, { method: 'GET', path: '/projects' }).body as {
    name: string;
    tags: string[];
  }[];
  assert.deepEqual(
    list.map((project) => [project.name, project.tags]),
    [
      ['Deck', []],
      ['Roof', ['a', 'b']],
    ],
  );
  const one = handle(db, { method: 'GET', path: '/projects/1' }).body as { tags: string[] };
  assert.deepEqual(one.tags, ['a', 'b']);
});

test('PUT replaces the tags', () => {
  const db = withProject();
  handle(db, { method: 'PUT', path: '/projects/1/tags', body: { tags: ['a', 'b'] } });
  handle(db, { method: 'PUT', path: '/projects/1/tags', body: { tags: ['c'] } });
  const one = handle(db, { method: 'GET', path: '/projects/1' }).body as { tags: string[] };
  assert.deepEqual(one.tags, ['c']);
});

test('bad tags are a 400 and a missing project a 404', () => {
  const db = withProject();
  const blank = { method: 'PUT', path: '/projects/1/tags', body: { tags: ['  '] } };
  assert.equal(handle(db, blank).status, 400);
  const number = { method: 'PUT', path: '/projects/1/tags', body: { tags: [3] } };
  assert.equal(handle(db, number).status, 400);
  const missing = { method: 'PUT', path: '/projects/9/tags', body: { tags: ['a'] } };
  assert.equal(handle(db, missing).status, 404);
});

test('the list shows tags as escaped chips', () => {
  const html = renderProjectList([{ id: 1, name: 'Roof', budget: 0, tags: ['x<y', 'z'] }] as never);
  assert.match(html, /<span class="tag">x&lt;y<\/span>/);
  assert.match(html, /<span class="tag">z<\/span>/);
});

test('existing databases upgrade and start with no tags', () => {
  const db = legacyDb();
  db.exec("INSERT INTO projects (id, name, budget) VALUES (1, 'Old', 5)");
  migrate(db);
  const list = handle(db, { method: 'GET', path: '/projects' }).body as { tags: string[] }[];
  assert.deepEqual(list[0]?.tags, []);
});
