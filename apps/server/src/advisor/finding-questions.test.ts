import { describe, expect, it } from 'vitest';
import type { SystemOneResponse } from './intake-questions.ts';
import {
  buildFindingQuestions,
  FINDING_QUESTION,
  findingKey,
  findingKind,
  isCorrectnessFinding,
  readFindings,
} from './finding-questions.ts';

const PARENS_FINDING =
  '`src/money.ts:14`: `"((5.00)"` is accepted because `hasParens` only looks at the first and last characters; `parseCents(\'((5.00)\')` returns -500 when it should throw.';
const ABS_FINDING =
  "Critical regression: the unconditional `Math.abs` in `parseCents` turns `-$50` positive, so `parseCents('-$5.00')` now returns 500 instead of -500.";

const NITS = [
  'Nit: `parseCents` could be named `toCents` to match the other helpers.',
  'Consider extracting the parentheses regex into a named constant for readability.',
  'Typo in the comment above `hasParens` ("paranthesis").',
  'Formatting: the new lines use 4-space indentation instead of 2.',
  'The variable name `v` is unclear; `value` would read better.',
  'The change matches the request.',
];

const answered = (nouls: Record<string, number>): SystemOneResponse => ({
  model: 'jev-1.13.0',
  answers: Object.fromEntries(
    Object.entries(nouls).map(([key, noul]) => [key, { type: 'noul' as const, noul }]),
  ),
});

describe('correctness finding rules', () => {
  it('counts the two Critic findings that caught real money-parsing bugs', () => {
    expect(isCorrectnessFinding(PARENS_FINDING)).toBe(true);
    expect(isCorrectnessFinding(ABS_FINDING)).toBe(true);
  });

  it('counts a missed requirement and an uncovered edge case', () => {
    expect(isCorrectnessFinding('The divider test the request asked for is missing')).toBe(true);
    expect(
      isCorrectnessFinding(
        '`(+$5)` is accepted; a plus sign inside parentheses should be rejected',
      ),
    ).toBe(true);
    expect(isCorrectnessFinding('No test covers the cent-sharing loop')).toBe(true);
  });

  it('ignores style, naming, readability nits and praise', () => {
    for (const nit of NITS) expect(isCorrectnessFinding(nit), nit).toBe(false);
  });

  it('ignores empty findings', () => {
    expect(isCorrectnessFinding('   ')).toBe(false);
  });
});

/** The s04 Critic findings the Auto-edit fix loop chased in the developer's-day rerun (N2). */
const N2_HARDENING = [
  '`apps/web/src/analytics/spend-csv.ts:13`: Project names can begin with `=`, `+`, `-`, or `@`, and the export writes them as spreadsheet formulas. CSV quoting does not prevent formula execution when the file is opened in a spreadsheet.',
  '`apps/web/src/analytics/spend-csv.ts:7`: Project names can begin with `=`, `+`, `-`, or `@`. The export writes those values unchanged, so opening the CSV in a spreadsheet can execute them as formulas. CSV quoting does not prevent this; the existing audit CSV exporter neutralizes such values.',
  '[spend-csv.ts:5](spend-csv.ts:5): A project name beginning with `=`, `+`, `-`, or `@` is exported unchanged and can run as a formula when opened in a spreadsheet. The existing audit CSV neutralizes these values. This is a safety concern even though the planned quoting rule was followed.',
  '`apps/web/src/analytics/SpendTab.tsx:65`: The blob URL is revoked immediately after `link.click()`. Browsers that start the download asynchronously may lose access to the file; revoke it after the download has started.',
  '`apps/web/src/analytics/SpendTab.tsx:65`: The blob URL is revoked immediately after `link.click()`. Browsers that start the download asynchronously may lose access to the file; revoke it after the download has started. A zero-delay timer does not guarantee that the download has started.',
  '`apps/web/src/analytics/spend-csv.ts:7`: A field containing `\\r` is left unquoted. Some CSV readers treat it as a row break, which can corrupt the exported rows.',
];

describe('hardening suggestions are not correctness bugs (N2)', () => {
  it('reads the rerun’s formula-injection, \\r-quoting and blob-URL findings as suggestions', () => {
    for (const finding of N2_HARDENING) {
      expect(findingKind(finding), finding).toBe('suggestion');
      expect(isCorrectnessFinding(finding), finding).toBe(false);
    }
  });

  it('keeps Jev from turning a hardening suggestion into a fix turn', () => {
    const readings = readFindings(
      N2_HARDENING.slice(0, 2),
      answered({ finding_1: 0.95, finding_2: 0.9 }),
    );
    expect(readings.map((reading) => [reading.correct, reading.kind, reading.by])).toEqual([
      [false, 'suggestion', 'rules'],
      [false, 'suggestion', 'rules'],
    ]);
    // Jev may still say no to a rule bug, and yes to an unclear one.
    const mixed = readFindings(
      [PARENS_FINDING, 'The export button label moved'],
      answered({ finding_1: 0.1, finding_2: 0.9 }),
    );
    expect(mixed.map((reading) => reading.correct)).toEqual([false, true]);
  });

  it('still counts a missed plan step, a wrong result and a real vulnerability as bugs', () => {
    expect(
      findingKind(
        'Plan: The download step is incomplete at SpendTab.tsx:21: it omits the planned UTF-8 charset and date-range filename (`spend.csv` is used instead).',
      ),
    ).toBe('bug');
    expect(
      findingKind(
        '`GET /projects/:id` returns tags in insertion order instead of the sorted order `PUT /projects/:id/tags` answers with.',
      ),
    ).toBe('bug');
    expect(
      findingKind('`renderProjectRow` inserts the tag name unescaped into the HTML, an XSS hole.'),
    ).toBe('bug');
    expect(
      findingKind(
        'The new `/export` query interpolates `projectId` into the SQL string: SQL injection.',
      ),
    ).toBe('bug');
    expect(
      findingKind(
        'The request asks for `\\r` to be quoted too, and a field containing `\\r` is left unquoted.',
      ),
    ).toBe('bug');
    expect(
      findingKind(
        "`formatCell` returns `=SUM(A1)` unchanged instead of `'=SUM(A1)` as the plan requires.",
      ),
    ).toBe('bug');
  });

  it('reads general security advice without a concrete hole as not a bug', () => {
    expect(isCorrectnessFinding('Consider rate limiting the new export endpoint.')).toBe(false);
    expect(findingKind('Security: the token may leak into logs in some clients.')).toBe(
      'suggestion',
    );
  });
});

describe('asking Jev about findings', () => {
  it('asks one yes/no question per finding with the task and diff as state', () => {
    const asked = buildFindingQuestions({
      request: 'Accept amounts in parentheses as negative.',
      diff: '+const hasParens = text.startsWith("(")',
      findings: [PARENS_FINDING, NITS[0]!],
    });
    expect(Object.keys(asked.questions)).toEqual([findingKey(0), findingKey(1)]);
    expect(asked.questions.finding_1).toMatchObject({
      type: 'noul',
      instructions: { question: FINDING_QUESTION, finding: PARENS_FINDING },
    });
    expect(asked.state).toEqual({
      task: 'Accept amounts in parentheses as negative.',
      diff: '+const hasParens = text.startsWith("(")',
    });
  });

  it('adds the agreed plan to the state when there is one', () => {
    const asked = buildFindingQuestions({
      request: 'Build the CSV export from the plan.',
      plan: '1. Quote fields with commas, quotes or newlines.',
      diff: '+export function csvField() {}',
      findings: [N2_HARDENING[0]!],
    });
    expect(asked.state).toMatchObject({ plan: '1. Quote fields with commas, quotes or newlines.' });
    expect(JSON.stringify(asked.questions.finding_1)).toContain('hardening');
  });

  it('uses the rules when Jev is missing or unsure', () => {
    const findings = [PARENS_FINDING, NITS[0]!];
    expect(readFindings(findings, null).map((reading) => [reading.correct, reading.by])).toEqual([
      [true, 'rules'],
      [false, 'rules'],
    ]);
    const unsure = readFindings(findings, answered({ finding_1: 0.4, finding_2: 0.7 }));
    expect(unsure.map((reading) => [reading.correct, reading.by, reading.noul])).toEqual([
      [true, 'rules', 0.4],
      [false, 'rules', 0.7],
    ]);
  });

  it('follows Jev at 0.8 or more either way', () => {
    const findings = [PARENS_FINDING, 'The helper could be shorter'];
    const readings = readFindings(findings, answered({ finding_1: 0.15, finding_2: 0.8 }));
    expect(readings.map((reading) => [reading.correct, reading.by])).toEqual([
      [false, 'jev'],
      [true, 'jev'],
    ]);
    expect(readings[0]!.rules).toBe(true);
  });
});
