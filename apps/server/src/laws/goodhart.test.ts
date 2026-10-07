import { describe, expect, it } from 'vitest';
import type { LawFacts } from './finding.ts';
import { guardFindings } from './goodhart.ts';

const facts = (overrides: Partial<LawFacts> = {}): LawFacts => ({
  request: 'Fix the rounding bug in src/money.ts.',
  replies: ['Fixed the rounding in src/money.ts.'],
  plan: [],
  ...overrides,
});

const fileDiff = (path: string, removed: string[], added: string[]) =>
  `diff --git a/${path} b/${path}
index 1111111..2222222 100644
--- a/${path}
+++ b/${path}
@@ -1,${removed.length} +1,${added.length} @@
${[...removed.map((line) => `-${line}`), ...added.map((line) => `+${line}`)].join('\n')}
`;

const texts = (patch: string, overrides: Partial<LawFacts> = {}) =>
  guardFindings(patch, facts(overrides)).map((finding) => finding.text);

describe('Goodhart guards', () => {
  it('flags a test that gains skip, loses assertions or loosens matchers', () => {
    const skipped = fileDiff(
      'src/money.test.ts',
      ["it('rounds', () => {", '  expect(round(1.005)).toBe(1.01);'],
      ["it.skip('rounds', () => {", '  expect(round(1.005)).toBeTruthy();'],
    );
    expect(texts(skipped)).toEqual([
      'Weakened `src/money.test.ts`: adds skip or only, loosens matchers — why?',
    ]);
    const fewer = fileDiff(
      'src/money.test.ts',
      ['  expect(a).toBe(1);', '  expect(b).toBe(2);'],
      ['  expect(a).toBe(1);'],
    );
    expect(texts(fewer)).toEqual(['Weakened `src/money.test.ts`: 1 fewer assertion — why?']);
  });

  it('leaves a test that only gains assertions alone', () => {
    const stronger = fileDiff('src/money.test.ts', [], ['  expect(round(2.5)).toBe(3);']);
    expect(texts(stronger)).toEqual([]);
  });

  it('flags updated snapshots and lint, typecheck or CI config the task did not ask for', () => {
    const patch = [
      fileDiff(
        'src/__snapshots__/money.test.ts.snap',
        ['exports[`a`] = `1`;'],
        ['exports[`a`] = `2`;'],
      ),
      fileDiff('tsconfig.json', ['  "strict": true,'], ['  "strict": false,']),
      fileDiff(
        'package.json',
        ['    "test": "vitest run",'],
        ['    "test": "vitest run --passWithNoTests",'],
      ),
    ].join('');
    expect(texts(patch)).toEqual([
      'Updated snapshot `src/__snapshots__/money.test.ts.snap` — check it matches the intended behaviour.',
      "Changed typecheck config `tsconfig.json`, which the task didn't ask for — why?",
      "Changed the `test` script in `package.json`, which the task didn't ask for — why?",
    ]);
  });

  it('does not flag config the request asks to change', () => {
    const patch = fileDiff('tsconfig.json', ['  "strict": true,'], ['  "strict": false,']);
    expect(texts(patch, { request: 'Turn off strict mode in tsconfig.' })).toEqual([]);
  });

  it('flags files outside the request and plan when they name files', () => {
    const patch = [
      fileDiff('src/money.ts', ['a'], ['b']),
      fileDiff('src/money-helpers.ts', ['a'], ['b']),
      fileDiff('apps/billing/invoice.ts', ['a'], ['b']),
    ].join('');
    expect(texts(patch)).toEqual([
      'Changed `apps/billing/invoice.ts`, outside the request and plan.',
    ]);
    expect(texts(patch, { request: 'Fix the rounding bug.', replies: [] })).toEqual([]);
  });

  it('leaves out tests that sit next to changed code', () => {
    const patch = [
      fileDiff('src/money.ts', ['a'], ['b']),
      fileDiff('apps/billing/invoice.ts', ['a'], ['b']),
      fileDiff('apps/billing/invoice.test.ts', ['a'], ['b']),
      fileDiff('apps/billing/__tests__/totals.spec.ts', ['a'], ['b']),
      fileDiff('apps/reports/export.test.ts', ['a'], ['b']),
    ].join('');
    expect(guardFindings(patch, facts()).map((finding) => finding.path)).toEqual([
      'apps/billing/invoice.ts',
      'apps/reports/export.test.ts',
    ]);
  });

  it('says nothing about scope in a PR follow-up round or after the Critic reviewed', () => {
    const patch = [
      fileDiff('src/money.ts', ['a'], ['b']),
      fileDiff('apps/billing/invoice.ts', ['a'], ['b']),
    ].join('');
    expect(texts(patch, { followUp: true })).toEqual([]);
    expect(texts(patch, { reviewed: true })).toEqual([]);
  });
});
