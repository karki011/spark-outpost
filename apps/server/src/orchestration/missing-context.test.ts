import { describe, expect, it } from 'vitest';
import { missingContext } from './missing-context.ts';

describe('missing context', () => {
  it('finds the sentence where the Builder says it could not find what was meant', () => {
    expect(
      missingContext(
        'I looked around. There is no src/dates.ts in this repo. Nothing changed.',
        null,
      ),
    ).toBe('There is no src/dates.ts in this repo.');
    expect(
      missingContext('This request is too vague; I need clarification on what to wrap up.', null),
    ).toBe('This request is too vague; I need clarification on what to wrap up.');
    expect(missingContext('', "ENOENT: no such file or directory, open 'a.ts'")).toBe(
      "ENOENT: no such file or directory, open 'a.ts'",
    );
    expect(missingContext('Which file should I change?', null)).toBe('Which file should I change?');
  });

  it('ignores ordinary failures and finished work', () => {
    expect(missingContext('Added the retry and a test. Tests pass.', null)).toBeNull();
    expect(missingContext('', 'The agent hit a problem.')).toBeNull();
    expect(missingContext('', null)).toBeNull();
  });

  it('clips a long sentence', () => {
    const long = `I could not find ${'the thing '.repeat(60)}anywhere.`;
    expect(missingContext(long, null)!.length).toBeLessThanOrEqual(240);
  });
});
