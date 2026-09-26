import { describe, expect, it } from 'vitest';
import { chooseSplit, laneQuestions, parseLaneAnswers } from './lane-choice.ts';
import { noulVerdict } from './parallel-choice.ts';
import { laneSummary } from './parallel-jev.ts';
import { choosePlacement } from './placement.ts';

const STEPS = ['Create the CSV writer\nFiles: src/csv.ts', 'Add a dependency\nFiles: package.json'];
const LANES = [[0], [1]];

describe('Jev’s lane questions', () => {
  it('describes each chain with its files and the sensitive ones', () => {
    const asked = laneQuestions(STEPS, LANES);
    expect(asked.chains).toEqual({
      A: { steps: [1], changes: ['src/csv.ts'], sensitive: [] },
      B: { steps: [2], changes: ['package.json'], sensitive: ['package.json (a manifest)'] },
    });
    expect(Object.keys(asked.questions)).toEqual(['one_builder', 'same_folder']);
  });

  it('reads the two nouls', () => {
    const response = {
      model: 'jev',
      answers: {
        one_builder: { type: 'noul' as const, noul: 0.9 },
        same_folder: { type: 'noul' as const, noul: 0.3 },
      },
    };
    const verdicts = parseLaneAnswers(response);
    expect(verdicts.oneBuilder?.value).toBe(true);
    expect(verdicts.sameFolder?.value).toBeNull();
    expect(parseLaneAnswers(null)).toEqual({ oneBuilder: null, sameFolder: null });
  });
});

describe('splitting chains', () => {
  const any = [[0, 1], [2]];

  it('keeps one Builder when Jev is sure it is as good, and splits when Jev is sure it is not', () => {
    expect(chooseSplit(any, any, noulVerdict(0.9))).toMatchObject({ lanes: [], source: 'jev' });
    expect(chooseSplit(any, [], noulVerdict(0.1))).toMatchObject({ lanes: any, source: 'jev' });
  });

  it('falls back to the large-chain rule when Jev is unsure, and follows forced options', () => {
    expect(chooseSplit(any, [], noulVerdict(0.6))).toMatchObject({ lanes: [], source: 'rules' });
    expect(chooseSplit(any, [], noulVerdict(0.9), 'any')).toMatchObject({
      lanes: any,
      source: 'forced',
    });
    expect(chooseSplit(any, [], noulVerdict(0.1), 'large')).toMatchObject({
      lanes: [],
      source: 'rules',
    });
  });

  it('summarises both decisions next to the rule', () => {
    const split = chooseSplit(LANES, [], noulVerdict(0.1));
    const placement = choosePlacement(STEPS, LANES, {
      answered: true,
      verdict: noulVerdict(0.95),
    });
    expect(laneSummary(split, placement, LANES)).toBe(
      'Chains: split (jev; Jev 0.10 on one Builder; rule: one Builder) · shared tree (Jev is sure the Builders can share the folder; Jev 0.95 on sharing; rule: worktrees)',
    );
    expect(laneSummary(split, null, [[0]])).toBeNull();
  });
});
