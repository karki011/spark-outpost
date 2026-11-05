import assert from 'node:assert/strict';
import { test } from 'node:test';
import { titleCase } from '../../src/text.ts';

test('capitalises each word', () => {
  assert.equal(titleCase('blue  ceramic MUG'), 'Blue Ceramic Mug');
});
