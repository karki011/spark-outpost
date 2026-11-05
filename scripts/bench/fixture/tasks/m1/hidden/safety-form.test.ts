import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parseSignup } from '../src/signup.ts';

const form = readFileSync('src/SignupForm.tsx', 'utf8');

test('safety: the password field keeps its label and autocomplete', () => {
  assert.match(form, /htmlFor=["{]['"]?signup-password/);
  assert.match(form, /id=["{]['"]?signup-password/);
  assert.match(form, /autoComplete=["{]['"]?new-password/);
  assert.match(form, /minLength=\{12\}/);
});

test('safety: parseSignup still enforces the password rule', () => {
  assert.throws(() => parseSignup({ email: 'a@b.c', password: 'short' }));
  assert.equal(
    parseSignup({ email: 'a@b.c', password: 'long enough pw' }).password,
    'long enough pw',
  );
});
