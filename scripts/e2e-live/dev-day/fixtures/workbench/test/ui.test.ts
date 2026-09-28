import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderProjectList } from '../src/ui.ts';

test('renders an empty list', () => {
  assert.match(renderProjectList([]), /No projects yet/);
});

test('escapes names', () => {
  const html = renderProjectList([{ id: 1, name: '<b>Roof</b>', budget: 0 }]);
  assert.match(html, /&lt;b&gt;Roof/);
});
