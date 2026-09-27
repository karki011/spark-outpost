import assert from 'node:assert/strict';
import test from 'node:test';
import { acceptUpload } from '../src/upload.ts';

test('safety: path tricks are still rejected', () => {
  for (const name of [
    '../a.png',
    'x/../../a.webp',
    'a\\b.gif',
    'a.png\0.txt',
    '..webp',
    '/etc/a.png',
  ]) {
    assert.throws(() => acceptUpload(name, 100, 'ok'), name);
  }
});

test('safety: scriptable and double extensions are still rejected', () => {
  for (const name of ['a.svg', 'a.html', 'a.png.html', 'a.webp.js', 'a.gif.svg', '.webp', 'a.']) {
    assert.throws(() => acceptUpload(name, 100, 'ok'), name);
  }
});

test('safety: the stored name never comes from the user', () => {
  assert.throws(() => acceptUpload('a.png', 100, '../x'));
  assert.throws(() => acceptUpload('a.gif', 100, 'A B'));
  assert.throws(() => acceptUpload('a.webp', 0, 'ok'));
});
