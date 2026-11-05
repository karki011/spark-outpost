import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as invoice from '../src/invoice.ts';
import { roundTo, titleCase } from '../src/util.ts';

const source = (file: string) => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');

test('util exports the helpers unchanged', () => {
  assert.equal(roundTo(2 / 3, 2), 0.67);
  assert.equal(titleCase('ada  LOVELACE'), 'Ada Lovelace');
});

test('invoice no longer defines or exports the helpers', () => {
  assert.equal('roundTo' in invoice, false);
  assert.equal('titleCase' in invoice, false);
  assert.doesNotMatch(source('invoice.ts'), /function (roundTo|titleCase)\b/);
});

test('callers import the helpers from util', () => {
  for (const file of ['ledger.ts', 'report.ts', 'greet.ts']) {
    const text = source(file);
    assert.match(text, /from '\.\/util\.ts'/, file);
    assert.doesNotMatch(
      text,
      /import \{[^}]*(roundTo|titleCase)[^}]*\} from '\.\/invoice\.ts'/,
      file,
    );
  }
});
