import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parseSignup } from '../src/signup.ts';

const form = readFileSync(new URL('../src/SignupForm.tsx', import.meta.url), 'utf8');

test('parseSignup returns the date of birth', () => {
  const signup = parseSignup({ name: 'Ada', email: 'ada@example.com', birthDate: '1990-05-17' });
  assert.equal((signup as unknown as { birthDate: string }).birthDate, '1990-05-17');
});

test('the form has a birthDate field', () => {
  assert.match(form, /name=["{]['"]?birthDate/);
});
