import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { greeting } from '../src/greet.ts';

test('greeting is spelled correctly', () => {
  assert.equal(greeting('grace hopper'), 'Welcome back, Grace Hopper!');
});

test('README is spelled correctly', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(readme, /bookkeeping library for invoices/);
  assert.doesNotMatch(readme, /libary/);
});
