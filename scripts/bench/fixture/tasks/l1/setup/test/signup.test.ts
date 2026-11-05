import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSignup } from '../src/signup.ts';

test('parseSignup trims the name and email', () => {
  assert.deepEqual(parseSignup({ name: ' Ada ', email: 'ada@example.com ' }), {
    name: 'Ada',
    email: 'ada@example.com',
  });
});

test('parseSignup rejects a missing name', () => {
  assert.throws(() => parseSignup({ name: '', email: 'ada@example.com' }));
});
