import { describe, expect, it } from 'vitest';
import { stem, suggestSpark, type MatchableSpark } from './spark-match.ts';

const spark = (name: string, role: string, instructions = ''): MatchableSpark => ({
  id: name.toLowerCase(),
  name,
  role,
  instructions,
});

const roster = [
  spark('Pip', 'Code reviewer', 'Review changes for bugs, risky edits and missing tests.'),
  spark('Wren', 'Docs writer', 'Write and update docs in short, plain sentences.'),
  spark('Bolt', 'Bug fixer', 'Reproduce the bug before changing code.'),
];
const suggested = (draft: string, sparks: readonly MatchableSpark[] = roster) =>
  suggestSpark(draft, sparks)?.name ?? null;

describe('stem', () => {
  it('folds common endings onto one base', () => {
    expect(['review', 'reviews', 'reviewer', 'reviewing', 'reviewed'].map(stem)).toEqual(
      Array(5).fill('review'),
    );
    expect(['fix', 'fixes', 'fixer', 'fixing', 'fixed'].map(stem)).toEqual(Array(5).fill('fix'));
    expect(['doc', 'docs'].map(stem)).toEqual(['doc', 'doc']);
    expect(['debug', 'debugging', 'planner', 'planning'].map(stem)).toEqual([
      'debug',
      'debug',
      'plan',
      'plan',
    ]);
  });
});

describe('suggestSpark', () => {
  it('matches the role and its synonyms', () => {
    expect(suggested('review this PR')).toBe('Pip');
    expect(suggested('can you do a code review of the diff')).toBe('Pip');
    expect(suggested('I would like some feedback on this function')).toBe('Pip');
    expect(suggested('update the README with the new flags')).toBe('Wren');
    expect(suggested('write docs for the API')).toBe('Wren');
    expect(suggested('there is a crash on login')).toBe('Bolt');
    expect(suggested('debugging the flaky upload')).toBe('Bolt');
  });

  it('matches the Spark’s name as a whole word', () => {
    expect(suggested('ask pip what it thinks')).toBe('Pip');
    expect(suggested('what would Wren say about this page')).toBe('Wren');
    expect(suggested('the pipeline is slow today')).toBeNull();
  });

  it('matches significant words of a role that fits no known group', () => {
    const sparks = [spark('Nova', 'Kubernetes deployments')];
    expect(suggested('roll out the new kubernetes deployment', sparks)).toBe('Nova');
    expect(suggested('roll out the new build', sparks)).toBeNull();
    expect(suggested('scale the kubernetes cluster', sparks)).toBeNull();
  });

  it('uses the leading instruction word only when the role says nothing', () => {
    const sparks = [spark('Ada', 'Helper', 'Review every change for risk. Fix nothing.')];
    expect(suggested('please review my change', sparks)).toBe('Ada');
    expect(suggested('fix the build please', sparks)).toBeNull();
  });

  it('stays quiet on unrelated messages', () => {
    for (const draft of [
      'add a dark mode toggle to settings',
      'what does this function do?',
      'write the code for the parser',
      'preview the build output',
      'rename the helper and move it to utils',
      'why is the bundle so large',
      'ship it',
    ]) {
      expect(suggested(draft)).toBeNull();
    }
  });

  it('stays quiet for one word, slash commands, and a draft that already mentions a Spark', () => {
    expect(suggested('review')).toBeNull();
    expect(suggested('/review the last change')).toBeNull();
    expect(suggested('@Wren review this page')).toBeNull();
    expect(suggested('   ')).toBeNull();
  });

  it('offers one Spark: the highest score, then the earliest matching word', () => {
    expect(suggested('fix the typo in the docs')).toBe('Bolt');
    expect(suggested('document the fix for the login bug')).toBe('Wren');
    expect(suggested('review the docs, pip')).toBe('Pip');
  });

  it('offers nothing without Sparks', () => {
    expect(suggested('review this PR', [])).toBeNull();
  });
});
