import assert from 'node:assert/strict';
import test from 'node:test';
import { entriesToCsv } from '../src/csv.ts';
import { reportCsv } from '../src/report.ts';

test('the CSV uses semicolons', () => {
  assert.equal(
    entriesToCsv([
      { category: 'food', cents: 1250 },
      { category: 'rent', cents: 90000 },
    ]),
    'category;cents\nfood;1250\nrent;90000',
  );
});

test('categories with a semicolon, quote or newline are quoted, commas are not', () => {
  assert.equal(entriesToCsv([{ category: 'a;b', cents: 1 }]), 'category;cents\n"a;b";1');
  assert.equal(entriesToCsv([{ category: 'say "hi"', cents: 2 }]), 'category;cents\n"say ""hi""";2');
  assert.equal(entriesToCsv([{ category: 'x,y', cents: 3 }]), 'category;cents\nx,y;3');
});

test('reportCsv sorts by category then cents', () => {
  assert.equal(
    reportCsv([
      { category: 'b', cents: 2 },
      { category: 'a', cents: 9 },
      { category: 'b', cents: 1 },
    ]),
    'category;cents\na;9\nb;1\nb;2',
  );
});
