import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const modules = (readFileSync('README.md', 'utf8').split(/^## Modules\s*$/m)[1] ?? '').split(
  /^## /m,
)[0]!;

test('both new modules are listed once in the README module list', () => {
  for (const file of ['src/csv.ts', 'src/reminders.ts']) {
    assert.equal(modules.split(file).length - 1, 1, file);
  }
  for (const file of ['src/money.ts', 'src/dates.ts', 'src/invoice.ts', 'src/report.ts']) {
    assert.ok(modules.includes(file), `${file} was dropped`);
  }
});
