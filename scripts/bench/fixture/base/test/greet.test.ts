import assert from 'node:assert/strict';
import test from 'node:test';
import { greeting } from '../src/greet.ts';

test('greets the customer by name', () => {
  assert.match(greeting('grace hopper'), /Grace Hopper!$/);
});
