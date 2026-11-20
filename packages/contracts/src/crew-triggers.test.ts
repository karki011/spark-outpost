import { describe, expect, it } from 'vitest';
import {
  anyTriggerOn,
  blockingFindings,
  findingsIn,
  branchMatches,
  workflowTriggersSchema,
} from './crew-triggers.ts';

describe('branchMatches', () => {
  it('matches every branch when no pattern is set', () => {
    expect(branchMatches('', 'main')).toBe(true);
    expect(branchMatches('  ', null)).toBe(true);
  });

  it('keeps one star inside a path part and lets two stars cross parts', () => {
    expect(branchMatches('spark/*', 'spark/fix-login')).toBe(true);
    expect(branchMatches('spark/*', 'spark/team/fix')).toBe(false);
    expect(branchMatches('spark/**', 'spark/team/fix')).toBe(true);
    expect(branchMatches('release-?', 'release-1')).toBe(true);
    expect(branchMatches('release-?', 'release-10')).toBe(false);
  });

  it('takes several patterns separated by commas or spaces', () => {
    expect(branchMatches('main, spark/*', 'main')).toBe(true);
    expect(branchMatches('main spark/*', 'spark/x')).toBe(true);
    expect(branchMatches('main, spark/*', 'feature/x')).toBe(false);
  });

  it('treats regex characters as plain text and needs a branch when a pattern is set', () => {
    expect(branchMatches('v1.2', 'v1x2')).toBe(false);
    expect(branchMatches('v1.2', 'v1.2')).toBe(true);
    expect(branchMatches('main', null)).toBe(false);
  });
});

describe('blockingFindings', () => {
  it('counts lines that start with a Critical or High label', () => {
    const text = [
      'Review done.',
      '- [Critical] SQL built from user input in search.ts',
      '* **[High]** token logged in debug output',
      'High: missing auth check on /admin',
      '1. [Medium] long function',
      '[Low] naming',
    ].join('\n');
    expect(blockingFindings(text)).toBe(3);
  });

  it('ignores prose that mentions the words', () => {
    expect(blockingFindings('No findings. Nothing critical, high marks overall.')).toBe(0);
    expect(blockingFindings('Highlights: tests pass')).toBe(0);
    expect(blockingFindings(null)).toBe(0);
  });
});

describe('findingsIn', () => {
  it('reads each labelled line with its severity and text', () => {
    const text = [
      'Review done.',
      '- [Critical] SQL built from user input in search.ts',
      '* **[High]** token logged in debug output',
      'High: missing auth check on /admin',
      '1. [Medium] long function',
      '[low] naming',
      'Nothing critical here.',
    ].join('\n');
    expect(findingsIn(text)).toEqual([
      { severity: 'critical', text: 'SQL built from user input in search.ts' },
      { severity: 'high', text: 'token logged in debug output' },
      { severity: 'high', text: 'missing auth check on /admin' },
      { severity: 'medium', text: 'long function' },
      { severity: 'low', text: 'naming' },
    ]);
  });

  it('finds nothing in a clean reply', () => {
    expect(findingsIn('No findings.')).toEqual([]);
    expect(findingsIn(null)).toEqual([]);
  });
});

describe('workflowTriggersSchema', () => {
  it('fills defaults and reports whether any trigger is on', () => {
    const triggers = workflowTriggersSchema.parse({});
    expect(triggers).toMatchObject({ debounceMinutes: 0, edits: false, branchGlob: '' });
    expect(anyTriggerOn(triggers)).toBe(false);
    expect(anyTriggerOn({ ...triggers, commit: true })).toBe(true);
  });

  it('refuses a debounce longer than a day', () => {
    expect(workflowTriggersSchema.safeParse({ debounceMinutes: 1441 }).success).toBe(false);
  });
});
