import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const readme = readFileSync('README.md', 'utf8');
const api = readme.split(/^## API\s*$/m)[1] ?? '';

test('the README has an API section', () => {
  assert.ok(api.trim().length > 0, 'no ## API section');
});

test('every money and date export is documented with its parameters', () => {
  const expected: Record<string, RegExp> = {
    formatCents: /formatCents\s*\(\s*cents/,
    parseCents: /parseCents\s*\(\s*text/,
    formatIsoDate: /formatIsoDate\s*\(\s*date/,
    addDays: /addDays\s*\(\s*date\s*[:,][^)]*days/,
  };
  for (const [name, pattern] of Object.entries(expected)) {
    assert.match(api, pattern, name);
  }
});

test('the opening of the README is kept', () => {
  assert.match(readme, /^# Ledger Lite/);
  assert.match(readme, /## Modules/);
});
