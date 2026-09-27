import { describe, expect, it } from 'vitest';
import type { SystemOneResponse } from '../advisor/intake-questions.ts';
import {
  INDEPENDENT_QUESTION,
  LARGE_QUESTION,
  agreement,
  buildParallelQuestions,
  chooseGroups,
  noulVerdict,
  parseParallelAnswers,
  type ParallelVerdicts,
} from './parallel-choice.ts';
import { planGroups, worthSplitting } from './parallel.ts';
import { parallelSummary } from './parallel-jev.ts';
import { dependsOn, stepFiles } from './step-files.ts';

const PERCENT = [
  'Create src/percent.ts exporting formatPercent, with tests in test/percent.test.ts',
  'In src/report.ts add shareLine using categoryShare and formatPercent from src/percent.ts, with tests in test/report.test.ts',
  'In src/invoice.ts add discountLabel using formatPercent imported from src/percent.ts, and test it in test/invoice.test.ts',
];

describe('files a step changes', () => {
  it('counts files named with a change verb and treats imports and mentions as reads', () => {
    expect(stepFiles(PERCENT[1]!)).toEqual({
      changes: ['src/report.ts', 'test/report.test.ts'],
      reads: ['src/percent.ts'],
    });
    expect(stepFiles('See src/money.ts for how parseCents works')).toEqual({
      changes: [],
      reads: ['src/money.ts'],
    });
    expect(stepFiles('Move roundTo from src/invoice.ts into src/util.ts').changes).toEqual([
      'src/invoice.ts',
      'src/util.ts',
    ]);
  });

  it('handles the plan steps seen in the live benchmark', () => {
    expect(
      stepFiles('Add half-away-from-zero rounding helper in money.ts and use it in parseCents')
        .changes,
    ).toEqual(['money.ts']);
    expect(stepFiles('Run cleanLedger on data/ledger.json and overwrite it').changes).toEqual([
      'data/ledger.json',
    ]);
  });

  it('reads the Architect’s Files line first', () => {
    const step =
      'Add shareLine to the report using src/percent.ts. Files: src/report.ts, test/report.test.ts';
    expect(stepFiles(step)).toEqual({
      changes: ['src/report.ts', 'test/report.test.ts'],
      reads: ['src/percent.ts'],
    });
    expect(
      stepFiles('Research: how dates are parsed in src/dates.ts. Files: none').changes,
    ).toEqual([]);
  });

  it('lets two readers of one file run together, but not a writer and a reader', () => {
    const [create, report, invoice] = PERCENT.map(stepFiles);
    expect(dependsOn(report!, invoice!)).toBe(false);
    expect(dependsOn(create!, report!)).toBe(true);
    expect(planGroups(PERCENT, [[1, 2]])).toEqual([[1, 2]]);
    expect(planGroups(PERCENT, [[0, 1, 2]])).toEqual([[1, 2]]);
    expect(
      planGroups(['Edit src/a.ts', 'Update src/b.ts to import from src/a.ts'], [[0, 1]]),
    ).toEqual([]);
  });

  it('sizes a step by the files it changes, not the ones it mentions', () => {
    expect(worthSplitting([[1, 2]], PERCENT, [])).toEqual([[1, 2]]);
    const mentionsOnly = [
      'x',
      'Add a line to src/a.ts using src/c.ts',
      'Add a line to src/b.ts using src/c.ts',
    ];
    expect(worthSplitting([[1, 2]], mentionsOnly, [])).toEqual([]);
  });
});

describe('Jev deciding parallelism', () => {
  it('asks one independence noul per adjacent pair and one size noul per step', () => {
    const asked = buildParallelQuestions('task', PERCENT);
    expect(Object.keys(asked.questions)).toEqual([
      'independent_1',
      'large_1',
      'independent_2',
      'large_2',
      'large_3',
    ]);
    expect(asked.questions.independent_2).toMatchObject({ type: 'noul' });
    expect(String(asked.questions.independent_2!.instructions)).toMatch(
      new RegExp(`^${INDEPENDENT_QUESTION}: \`steps.2\` and \`steps.3\``),
    );
    expect(String(asked.questions.large_1!.instructions).startsWith(LARGE_QUESTION)).toBe(true);
    expect(asked.state.steps).toMatchObject({ '2': { reads: ['src/percent.ts'] } });
    expect(Object.keys(asked.state)).toEqual(['task', 'steps']);
    expect(asked.state.steps).toMatchObject({
      '1': { text: PERCENT[0], changes: ['src/percent.ts', 'test/percent.test.ts'] },
    });
  });

  it('trusts a noul at 0.75 or 0.25, confidence 0.5 on the two-option scale', () => {
    expect(noulVerdict(0.8).value).toBe(true);
    expect(noulVerdict(0.8).confidence).toBeCloseTo(0.6);
    expect(noulVerdict(0.75).value).toBe(true);
    expect(noulVerdict(0.2).value).toBe(false);
    expect(noulVerdict(0.6).value).toBeNull();
    expect(noulVerdict(0.6).confidence).toBeCloseTo(0.2);
    const response: SystemOneResponse = {
      model: 'jev',
      answers: { independent_1: { type: 'noul', noul: 0.1 }, large_2: { type: 'noul', noul: 0.9 } },
    };
    const parsed = parseParallelAnswers(3, response);
    expect(parsed.independent.map((verdict) => verdict?.value ?? null)).toEqual([false, null]);
    expect(parsed.large.map((verdict) => verdict?.value ?? null)).toEqual([null, true, null]);
  });

  const verdicts = (
    independent: (number | null)[],
    large: (number | null)[],
  ): ParallelVerdicts => ({
    independent: independent.map((noul) => (noul === null ? null : noulVerdict(noul))),
    large: large.map((noul) => (noul === null ? null : noulVerdict(noul))),
  });

  it('runs steps in parallel when Jev is sure, even without an Architect hint', () => {
    const choice = chooseGroups(PERCENT, [], [], verdicts([0.1, 0.9], [0.9, 0.9, 0.9]));
    expect(choice.groups).toEqual([[1, 2]]);
    expect(choice.rulesGroups).toEqual([]);
    expect(choice.decided).toEqual([
      { steps: [1, 2], parallel: true, rules: false, source: 'jev' },
    ]);
    expect(agreement(choice)).toEqual({ asked: 5, agreed: 4 });
    expect(parallelSummary(choice)).toBe(
      'Parallel: steps 2 and 3 · the rules would have run none · Jev agreed with the rules on 4 of 5',
    );
  });

  it('keeps a hinted group sequential when Jev is sure the steps depend on each other', () => {
    const choice = chooseGroups(
      PERCENT,
      [[1, 2]],
      [1, 2],
      verdicts([null, 0.1], [null, null, null]),
    );
    expect(choice.rulesGroups).toEqual([[1, 2]]);
    expect(choice.groups).toEqual([]);
    expect(choice.decided).toEqual([
      { steps: [1, 2], parallel: false, rules: true, source: 'jev' },
    ]);
  });

  it('keeps small steps in one Builder when Jev is sure they are quick', () => {
    const choice = chooseGroups(PERCENT, [[1, 2]], [], verdicts([null, null], [null, 0.1, 0.9]));
    expect(choice.groups).toEqual([]);
    expect(choice.sizes.map((size) => size.source)).toEqual(['rules', 'jev', 'jev']);
  });

  it('falls back to the heuristics and the Architect’s lines when Jev is unsure', () => {
    const unsure = verdicts([0.6, 0.4], [0.5, 0.5, 0.5]);
    expect(chooseGroups(PERCENT, [[1, 2]], [], unsure).groups).toEqual([[1, 2]]);
    expect(chooseGroups(PERCENT, [], [], unsure).groups).toEqual([]);
    expect(chooseGroups(PERCENT, [[1, 2]], [], null)).toMatchObject({
      groups: [[1, 2]],
      decided: [{ steps: [1, 2], parallel: true, rules: true, source: 'rules' }],
    });
  });
});
