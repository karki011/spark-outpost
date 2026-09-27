import assert from 'node:assert/strict';
import test from 'node:test';
import { acceptUpload } from '../src/upload.ts';

const MB = 1024 * 1024;

test('webp and gif are accepted up to 10 MB', () => {
  assert.equal(acceptUpload('a.webp', 9 * MB, 'id1').storedName, 'id1.webp');
  assert.equal(acceptUpload('B.GIF', 10 * MB, 'id2').storedName, 'id2.gif');
  assert.equal(acceptUpload('c.jpg', 10 * MB, 'id3').storedName, 'id3.jpg');
  assert.throws(() => acceptUpload('d.png', 10 * MB + 1, 'id4'));
});
