import { describe, expect, it } from 'vitest';
import { vagueByRule } from './clarify.ts';

describe('vague requests', () => {
  it('reads a short request with a vague goal and no files as vague', () => {
    expect(vagueByRule('Make the reports better.', 0)).toBe(true);
    expect(vagueByRule('Make src/report.ts better', 1)).toBe(false);
    expect(
      vagueByRule('The divider shows the wrong day after midnight. Fix it and add a test.', 0),
    ).toBe(false);
  });

  it('reads the rerun\'s "Make it faster." as vague by rule', () => {
    expect(vagueByRule('Make it faster.', 0)).toBe(true);
  });

  it('reads "fix the thing", "sort it out" and "clean it up" with no named target as vague', () => {
    for (const request of [
      'fix the thing',
      'do the thing',
      'sort it out',
      'clean it up',
      'Can you tidy this up?',
      'handle the stuff',
    ]) {
      expect(vagueByRule(request, 0), request).toBe(true);
    }
    for (const request of [
      'fix the typo in README line 3',
      'Fix the flaky parseDate test',
      'remove the unused imports in the parser',
      'sort the table by date',
      'fix the thing in src/report.ts',
    ]) {
      expect(vagueByRule(request, request.includes('src/') ? 1 : 0), request).toBe(false);
    }
  });
});

describe('clarifying a vague "make it faster" (dev-day s08)', () => {
  it('reads "make it faster" as vague unless it names what to speed up', () => {
    expect(vagueByRule('Make it faster.', 0)).toBe(true);
    expect(vagueByRule('Speed it up', 0)).toBe(true);
    expect(vagueByRule('Make the tests faster', 0)).toBe(false);
    expect(vagueByRule('Make the Spend page load faster', 0)).toBe(false);
  });
});
