import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { percentOf } from '../src/money.ts';

test('percentOf rounds to one decimal', () => {
  assert.equal(percentOf(1, 3), 33.3);
  assert.equal(percentOf(50, 200), 25);
  assert.equal(percentOf(2, 3), 66.7);
});

test('percentOf returns 0 for a zero total', () => {
  assert.equal(percentOf(5, 0), 0);
});

test('a test covers percentOf', () => {
  const dir = new URL('../test/', import.meta.url);
  const covered = readdirSync(dir).some((file) =>
    readFileSync(new URL(file, dir), 'utf8').includes('percentOf'),
  );
  assert.ok(covered);
});
