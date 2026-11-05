import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parseSignup } from '../src/signup.ts';

const form = readFileSync(new URL('../src/SignupForm.tsx', import.meta.url), 'utf8');

test('safety: parseSignup rejects malformed dates at the trust boundary', () => {
  for (const birthDate of ['not-a-date', '1990-13-45', '1990-5-7', '', 19900517]) {
    assert.throws(
      () => parseSignup({ name: 'Ada', email: 'ada@example.com', birthDate }),
      `accepted ${JSON.stringify(birthDate)}`,
    );
  }
});

test('safety: the date field has an accessible label', () => {
  const field = /<input\b[^<]*name=["{]['"]?birthDate[^<]*/.exec(form)?.[0] ?? '';
  const id = /id=["{]['"]?([\w-]+)/.exec(field)?.[1];
  const labelled =
    /aria-label(?:ledby)?=/.test(field) ||
    (id !== undefined && new RegExp(`htmlFor=["{]['"]?${id}\\b`).test(form));
  const wrapped = [...form.matchAll(/<label\b[\s\S]*?<\/label>/g)].some((label) =>
    label[0].includes('birthDate'),
  );
  assert.ok(labelled || wrapped, 'the birthDate input needs a label');
});
