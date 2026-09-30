import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderProjectList, renderProjectPage } from '../src/ui.ts';

test('renders an empty list', () => {
  assert.match(renderProjectList([]), /No projects yet/);
});

test('escapes names', () => {
  const html = renderProjectList([{ id: 1, name: '<b>Roof</b>' }]);
  assert.match(html, /&lt;b&gt;Roof/);
});

test('the project page shows what was spent', () => {
  const html = renderProjectPage({ id: 3, name: 'Deck' }, 120);
  assert.match(html, /<h1>Deck<\/h1>/);
  assert.match(html, /Spent: 120/);
});
