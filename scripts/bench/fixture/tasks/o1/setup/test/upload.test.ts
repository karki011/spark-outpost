import assert from 'node:assert/strict';
import test from 'node:test';
import { acceptUpload } from '../src/upload.ts';

test('accepts a small png', () => {
  assert.deepEqual(acceptUpload('Cat.PNG', 2048, 'abc-1'), {
    storedName: 'abc-1.png',
    extension: 'png',
  });
});

test('rejects other file types and large files', () => {
  assert.throws(() => acceptUpload('notes.txt', 10, 'a'));
  assert.throws(() => acceptUpload('big.jpg', 6 * 1024 * 1024, 'a'));
});
