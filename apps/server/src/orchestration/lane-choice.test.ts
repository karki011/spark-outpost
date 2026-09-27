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

  it('asks about sharing the folder only when a chain touches a sensitive file', () => {
    const plain = ['Create the CSV writer\nFiles: src/csv.ts', 'Add reports\nFiles: src/report.ts'];
    expect(Object.keys(laneQuestions(plain, LANES).questions)).toEqual(['one_builder']);
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

  it('lets the Architect’s parallel-chains line break the tie when Jev is unsure', () => {
    expect(chooseSplit(any, [], noulVerdict(0.6), 'jev', true)).toMatchObject({
      lanes: any,
      rule: [],
      source: 'architect',
    });
    expect(chooseSplit(any, any, noulVerdict(0.6), 'jev', false)).toMatchObject({
      lanes: [],
      source: 'architect',
    });
    expect(chooseSplit(any, [], null, 'jev', true)).toMatchObject({ source: 'architect' });
    expect(chooseSplit(any, [], noulVerdict(0.9), 'jev', false)).toMatchObject({
      lanes: [],
      source: 'jev',
    });
    const split = chooseSplit(LANES, [], noulVerdict(0.6), 'jev', true);
    expect(laneSummary(split, null, LANES)).toBe(
      'Chains: split (decided by Architect; Jev 0.60 on one Builder; Architect: parallel; rule: one Builder)',
    );
  });

  it('falls back to the large-chain rule when neither Jev nor the Architect says, and follows forced options', () => {
    expect(chooseSplit(any, [], noulVerdict(0.6))).toMatchObject({ lanes: [], source: 'rules' });
    expect(chooseSplit(any, [], null)).toMatchObject({ lanes: [], source: 'rules' });
    expect(chooseSplit(any, [], noulVerdict(0.6), 'large', true)).toMatchObject({
      lanes: [],
      source: 'rules',
    });
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
      'Chains: split (decided by Jev; Jev 0.10 on one Builder; rule: one Builder) · shared tree (Jev is sure the Builders can share the folder despite package.json; Jev 0.95 on sharing; rule: worktrees)',
    );
    const unsure = choosePlacement(STEPS, LANES, { answered: true, verdict: noulVerdict(0.6) });
    expect(laneSummary(split, unsure, LANES)).toContain(
      'worktrees (need: sensitive files, package.json is a manifest and Jev is unsure; Jev 0.60 on sharing; rule: worktrees)',
    );
    expect(laneSummary(split, null, [[0]])).toBeNull();
  });
});
