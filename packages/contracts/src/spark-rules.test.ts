import { describe, expect, it } from 'vitest';
import {
  ghAllowedRequestSchema,
  ghPrefixProblem,
  setSparkRuleRequestSchema,
} from './spark-rules.ts';

describe('ghPrefixProblem()', () => {
  it.each([
    'gh release create',
    'gh issue create',
    'gh pr close',
    'gh repo edit',
    '  GH  Pr  Ready ',
  ])('accepts %s', (prefix) => {
    expect(ghPrefixProblem(prefix)).toBeNull();
  });

  it.each([
    ['gh release', 'two words'],
    ['gh release create v1', 'two words'],
    ['git push origin', 'two words'],
    ['gh release create; rm -rf /', 'two words'],
    ['gh -R x release', 'two words'],
    ['gh api graphql', 'gh api'],
    ['gh auth token', 'gh auth'],
    ['gh pr merge', 'Merge a pull request'],
    ['gh pr review', 'Review or approve a pull request'],
    ['gh pr create', 'publish rules'],
    ['gh workflow run', 'Run a workflow'],
    ['gh run rerun', 'Run a workflow'],
    ['gh pr view', 'always allowed'],
    ['gh search code', 'always allowed'],
  ])('refuses %s', (prefix, words) => {
    expect(ghPrefixProblem(prefix)).toContain(words);
  });
});

describe('ghAllowedRequestSchema', () => {
  it('tidies the command', () => {
    expect(ghAllowedRequestSchema.parse({ prefix: ' GH release  create', allowed: true })).toEqual({
      prefix: 'gh release create',
      allowed: true,
    });
  });

  it('refuses a never-allowed command', () => {
    expect(ghAllowedRequestSchema.safeParse({ prefix: 'gh pr merge', allowed: true }).success).toBe(
      false,
    );
  });
});

describe('setSparkRuleRequestSchema', () => {
  it('takes a row the page shows and one of its choices', () => {
    expect(setSparkRuleRequestSchema.safeParse({ row: 'Push', choice: 'mode' }).success).toBe(true);
    expect(
      setSparkRuleRequestSchema.safeParse({ row: 'Gh(pr close)', choice: 'allow' }).success,
    ).toBe(false);
    expect(setSparkRuleRequestSchema.safeParse({ row: 'Push', choice: 'hold' }).success).toBe(
      false,
    );
  });
});
